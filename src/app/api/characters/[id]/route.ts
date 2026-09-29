import { lockCurrentReferenceInTransaction, StaleReferenceMutationError } from '@/services/reference-persistence-guard'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertCharacterOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { normalizeCanonicalName } from '@/lib/project-metadata'
import { markReferenceDependentsStaleInTransaction } from '@/services/content-lineage'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('角色 ID 格式无效', 400)
    const guard = await assertCharacterOwner(idNum, userId)
    if (guard) return guard
    const character = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
    if (!character) return apiError('Character not found', 404)
    return apiResponse(character)
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('角色 ID 格式无效', 400)
    const guard = await assertCharacterOwner(idNum, userId)
    if (guard) return guard
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('请求内容不是有效 JSON')
    const allowed = new Set(['name', 'role', 'age', 'gender', 'appearancePrompt', 'personality'])
    const unknown = Object.keys(body).filter(key => !allowed.has(key))
    if (unknown.length) return apiError(`不允许修改字段：${unknown.join('、')}`)
    const data: Record<string, string | null> = {}
    for (const key of allowed) {
        if (!(key in body)) continue
        const value = body[key]
        if (value !== null && typeof value !== 'string') return apiError(`${key} 格式无效`)
        if (key === 'name' && (typeof value !== 'string' || !value.trim())) return apiError('角色名称不能为空')
        const max = ['name', 'role'].includes(key) ? 100 : ['age', 'gender'].includes(key) ? 20 : 20_000
        if (typeof value === 'string' && value.length > max) return apiError(`${key} 内容过长`)
        data[key] = typeof value === 'string' ? value.trim() || null : null
    }
    const current = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
    if (!current) return apiError('Character not found', 404)
    const changed = Object.keys(data).filter(key => data[key] !== (current as unknown as Record<string, unknown>)[key])
    if (!changed.length) return apiResponse(current)
    const character = await prisma
        .$transaction(
            async tx => {
                await lockCurrentReferenceInTransaction(tx, { type: 'character', ...current })
                if (typeof data.name === 'string') data.canonicalName = normalizeCanonicalName(data.name)
                const updated = await tx.character.update({
                    where: { id: idNum },
                    data: { ...data, sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } }
                })
                return updated
            },
            { timeout: 60_000 }
        )
        .catch(error => {
            if (error instanceof StaleReferenceMutationError) return null
            throw error
        })
    if (!character) return apiError('内容已变化，请刷新后再保存', 409)
    return apiResponse(character)
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('角色 ID 格式无效', 400)
    const guard = await assertCharacterOwner(idNum, userId)
    if (guard) return guard
    const current = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
    if (!current) return apiError('Resource not found', 404)
    const deleted = await prisma
        .$transaction(
            async tx => {
                await lockCurrentReferenceInTransaction(tx, { type: 'character', ...current })
                await markReferenceDependentsStaleInTransaction(tx, { type: 'character', id: idNum, projectId: current.projectId }, '关联角色或场景已删除，请重新生成媒体', ['frame', 'audio'])
                const links = await tx.storyboardCharacter.findMany({ where: { characterId: idNum }, select: { storyboardId: true } })
                const storyboardIds = [...new Set(links.map(item => item.storyboardId))]
                await tx.characterStateEvent.updateMany({ where: { characterId: idNum, status: 'active' }, data: { status: 'superseded' } })
                await tx.storyboardCharacter.deleteMany({ where: { characterId: idNum } })
                await tx.character.update({ where: { id: idNum }, data: { deletedAt: new Date() } })
                await tx.refImageJob.updateMany({
                    where: { targetType: 'character', targetId: idNum, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } },
                    data: { phase: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null, error: '角色已删除，旧任务作废' }
                })
                if (storyboardIds.length) {
                    await tx.storyboard.updateMany({ where: { id: { in: storyboardIds } }, data: { operationVersion: { increment: 1 } } })
                    await tx.generation.updateMany({
                        where: { storyboardId: { in: storyboardIds }, status: { in: ['queued', 'processing'] } },
                        data: { status: 'cancelled', activeKey: null, errorMsg: '关联角色已删除，旧任务作废' }
                    })
                }
                return true
            },
            { timeout: 60_000 }
        )
        .catch(error => {
            if (error instanceof StaleReferenceMutationError) return false
            throw error
        })
    if (!deleted) return apiError('内容已变化，请刷新后重试', 409)
    return apiResponse({ id })
}
