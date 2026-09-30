import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { resolveGenerationRequestId } from '@/lib/generation-request'
import { genId } from '@/lib/id'
import { normalizeImageQuality } from '@/lib/image-quality'
import { assertCharacterOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { createJob } from '@/lib/refImageJobStore'
import { apiError, apiResponse } from '@/lib/utils'
import { isImageProvider, resolveCharacterReferenceRuntimePolicy, type CharacterReferenceRole, type ImageProvider } from '@/services/ai'
import { assertNanoBananaCredentialsConfigured, NanoBananaConfigurationError } from '@/services/banana'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { parseCharacterReferenceCandidates, runQueuedCharacterReferenceJob } from '@/services/character-reference-job'
import { markReferenceDependentsStaleInTransaction } from '@/services/content-lineage'
import { lockCurrentReferenceInTransaction, StaleReferenceMutationError } from '@/services/reference-persistence-guard'
import { after, NextRequest } from 'next/server'

type Params = { params: Promise<{ id: string }> }
export const maxDuration = 1800
function characterReferenceRole(value: unknown): CharacterReferenceRole | null {
    return value === undefined || value === null || value === 'full_body' ? 'full_body' : null
}

// 生成角色候选图：耗时长（图片模型 30~90s，慢的时候会顶网关 60s 超时），改为异步。
// 立即返回 jobId，后台跑生成 + 写库，前端轮询 /api/characters/[id]/reference/status/[jobId]。
// select / delete / clear 仍然同步返回。
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('角色 ID 格式无效', 400)
    const guard = await assertCharacterOwner(idNum, userId)
    if (guard) return guard
    try {
        const body = await req.json().catch(() => ({}))
        if (body.action === 'select') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            const character = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!character) return apiError('Character not found', 404)
            const role = characterReferenceRole(body.role)
            if (!role) return apiError('基础版支持单张全身角色参考图', 400)
            const stale = await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'character', ...character })
                    const selected = await tx.characterReferenceAsset.findFirst({ where: { characterId: idNum, role, status: 'selected', stateKey: null, deletedAt: null } })
                    if (character.referenceImageUrl === body.url && selected?.url === body.url) return { storyboards: 0 }
                    if (role === 'full_body') {
                        await tx.character.update({
                            where: { id: idNum },
                            data: { referenceImageUrl: body.url, sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } }
                        })
                    }
                    await tx.characterReferenceAsset.updateMany({ where: { characterId: idNum, role, status: 'selected', deletedAt: null }, data: { status: 'candidate' } })
                    const existing = await tx.characterReferenceAsset.findFirst({ where: { characterId: idNum, role, url: body.url, deletedAt: null } })
                    if (existing) await tx.characterReferenceAsset.update({ where: { id: existing.id }, data: { status: 'selected', sourceVersion: { increment: 1 } } })
                    else await tx.characterReferenceAsset.create({ data: { id: genId(), characterId: idNum, role, url: body.url, status: 'selected', sourceVersion: character.sourceVersion + 1 } })
                    return markReferenceDependentsStaleInTransaction(tx, { type: 'character', id: idNum, projectId: character.projectId }, '角色定稿参考图已变更，请重新生成关联分镜帧和视频')
                },
                { timeout: 60_000 }
            )
            return apiResponse({ referenceImageUrl: role === 'full_body' ? body.url : character.referenceImageUrl, role, stale })
        }

        if (body.action === 'delete') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            const character = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!character) return apiError('Character not found', 404)
            const role = characterReferenceRole(body.role)
            if (!role) return apiError('基础版支持单张全身角色参考图', 400)
            const selected = await prisma.characterReferenceAsset.findFirst({
                where: { characterId: idNum, role, url: body.url, status: 'selected', deletedAt: null },
                select: { id: true }
            })
            if (selected || (role === 'full_body' && character.referenceImageUrl === body.url)) return apiError('当前定稿图不能删除，请先选择其他候选图作为定稿')
            let candidates = parseCharacterReferenceCandidates(character.referenceCandidates).filter(url => url !== body.url)
            await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'character', ...character })
                    const latest = await tx.character.findUniqueOrThrow({ where: { id: idNum } })
                    candidates = parseCharacterReferenceCandidates(latest.referenceCandidates).filter(url => url !== body.url)
                    await tx.characterReferenceAsset.updateMany({
                        where: { characterId: idNum, role, url: body.url, deletedAt: null },
                        data: { deletedAt: new Date() }
                    })
                    if (role === 'full_body') {
                        await tx.character.update({
                            where: { id: idNum },
                            data: { referenceCandidates: JSON.stringify(candidates) }
                        })
                    }
                },
                { timeout: 60_000 }
            )
            return apiResponse({ role, referenceCandidates: role === 'full_body' ? candidates : parseCharacterReferenceCandidates(character.referenceCandidates) })
        }

        if (body.action === 'clear') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            const character = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!character) return apiError('Character not found', 404)
            if (character.referenceImageUrl !== body.url) return apiError('当前定稿图已变化，请刷新后重试', 409)
            let candidates = parseCharacterReferenceCandidates(character.referenceCandidates).filter(url => url !== body.url)
            const stale = await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'character', ...character })
                    const latest = await tx.character.findUniqueOrThrow({ where: { id: idNum } })
                    candidates = parseCharacterReferenceCandidates(latest.referenceCandidates).filter(url => url !== body.url)
                    await tx.character.update({
                        where: { id: idNum },
                        data: { referenceImageUrl: null, referenceCandidates: JSON.stringify(candidates), sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } }
                    })
                    await tx.characterReferenceAsset.updateMany({ where: { characterId: idNum, role: 'full_body', status: 'selected', deletedAt: null }, data: { status: 'candidate' } })
                    return markReferenceDependentsStaleInTransaction(tx, { type: 'character', id: idNum, projectId: character.projectId }, '角色定稿参考图已清除，请重新生成关联分镜帧和视频')
                },
                { timeout: 60_000 }
            )
            return apiResponse({ referenceImageUrl: null, referenceCandidates: candidates, stale })
        }

        const character = await prisma.character.findFirst({ where: { id: idNum, deletedAt: null } })
        if (!character) return apiError('Character not found', 404)

        const imageProvider: ImageProvider | undefined = isImageProvider(body.provider) ? body.provider : undefined
        const imageQuality = normalizeImageQuality(body.imageQuality)
        const role = characterReferenceRole(body.role)
        if (!role) return apiError('基础版支持单张全身角色参考图', 400)
        const replaceSelected = body.replaceSelected === true
        const requestId = resolveGenerationRequestId(body.requestId)
        const taskPolicy = await resolveCharacterReferenceRuntimePolicy(character.projectId, imageProvider)
        const taskProvider = taskPolicy.provider
        const promptVersion = taskPolicy.promptVersion
        if (taskProvider === 'banana') assertNanoBananaCredentialsConfigured()
        await assertSufficientPoints(userId, quoteGenerationPoints('reference', taskProvider))

        const job = await createJob('character', idNum.toString(), character.projectId.toString(), {
            promptVersion,
            provider: taskProvider,
            quality: imageQuality,
            role,
            mode: replaceSelected ? 'replace-selected' : 'candidate',
            requestId
        })
        if (!job.reused) {
            after(async () => {
                await runQueuedCharacterReferenceJob({
                    jobId: job.id,
                    characterId: idNum,
                    projectId: character.projectId,
                    userId,
                    imageProvider: taskProvider,
                    imageQuality,
                    promptVersion,
                    role,
                    replaceSelected,
                    requestId,
                    sourceOperationVersion: character.operationVersion
                })
            })
        }
        return apiResponse({ jobId: job.id, role, queued: job.phase === 'queued', resumed: job.reused })
    } catch (err) {
        if (err instanceof StaleReferenceMutationError) return apiError(err.message, 409)
        if (err instanceof BillingError) return apiError(err.message, err.status)
        if (err instanceof NanoBananaConfigurationError) return apiError(`Nano Banana 部署凭据不可用：${err.message}`, 503)
        const msg = err instanceof Error ? err.message : String(err)
        return apiError(msg, 500)
    }
}
