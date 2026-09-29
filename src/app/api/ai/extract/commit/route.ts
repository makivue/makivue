import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { normalizeCanonicalName } from '@/lib/project-metadata'
import { findObsoleteExtractedEntityIds, shouldReplaceExtractedCollection } from '@/lib/extract-commit-policy'
import type { ExtractedCharacter, ExtractedScene } from '@/services/llm'
import { Prisma } from '@/generated/prisma/client'
import { clearProjectExtractedEntitiesInTransaction } from '@/services/extracted-entities'
import { getVisualStyleProfile, parseNovelSetup } from '@/lib/novel'
import { extractionActiveKey } from '@/lib/extract-fingerprint'

export const maxDuration = 120

const EXTRACT_COMMIT_TRANSACTION_OPTIONS = {
    maxWait: 10_000,
    timeout: 60_000
} as const

type CommitMode = 'add' | 'merge' | 'overwrite' | 'ignore'

interface CommitCharacter extends Partial<ExtractedCharacter> {
    itemId: string
    mode?: CommitMode
}

interface CommitScene extends Partial<ExtractedScene> {
    itemId: string
    mode?: CommitMode
}

function normalizeExtractedGender(gender: string | null | undefined): '男' | '女' | null {
    const value = (gender ?? '').trim().toLowerCase()
    if (/女|female|woman|girl|feminine/.test(value)) return '女'
    if (/男|male|man|boy|masculine/.test(value)) return '男'
    return null
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()) : []
}

function mergeText(current: string | null, incoming: string | null | undefined): string | null {
    const next = incoming?.trim()
    if (!next) return current
    if (!current?.trim()) return next
    if (current.includes(next)) return current
    if (next.includes(current)) return next
    return `${current.trim()}；${next}`
}

function serverItemMap<T extends { itemId?: string }>(value: unknown): Map<string, T> {
    const rows = Array.isArray(value) ? (value as T[]) : []
    return new Map(rows.filter(row => typeof row.itemId === 'string' && row.itemId).map(row => [row.itemId!, row]))
}

function commitMode(value: unknown): CommitMode {
    return value === 'add' || value === 'merge' || value === 'overwrite' || value === 'ignore' ? value : 'merge'
}

function isExpiredTransactionError(error: unknown): boolean {
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
    const message = error instanceof Error ? error.message : String(error)
    return code === 'P2028' && /expired transaction|transaction.+timeout/i.test(message)
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const body = (await req.json().catch(() => null)) as { projectId?: string; jobId?: string; replaceAll?: boolean; characters?: CommitCharacter[]; scenes?: CommitScene[] } | null
    if (!body?.projectId) return apiError('projectId required')
    if (!body.jobId) return apiError('jobId required')
    const projectId = parseApiId(body.projectId)
    const jobId = parseApiId(body.jobId)
    if (projectId === null || jobId === null) return apiError('项目 ID 或提取任务 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const job = await prisma.extractJob.findFirst({ where: { id: jobId, projectId } })
    if (!job) return apiError('提取任务不存在或不属于该项目', 404)
    if (job.phase !== 'done') return apiError('只能提交已完成的提取任务', 409)
    if (job.committedAt) return apiError('该提取任务已经提交，不能重复入库', 409)
    const [currentScripts, project] = await Promise.all([
        prisma.episode.findMany({
            where: { projectId, deletedAt: null },
            orderBy: { episodeNumber: 'asc' },
            select: { episodeNumber: true, script: true }
        }),
        prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { novelSetup: true } })
    ])
    if (!project) return apiError('Project not found', 404)
    const visualStyleProfile = getVisualStyleProfile(parseNovelSetup(project.novelSetup))
    const { activeKey } = extractionActiveKey(projectId.toString(), currentScripts, visualStyleProfile)
    if (job.activeKey !== activeKey) return apiError('剧本在提取后已经变化，该提取结果已失效，请重新提取', 409)
    const serverCharacters = serverItemMap<ExtractedCharacter>(job.resultCharacters)
    const serverScenes = serverItemMap<ExtractedScene>(job.resultScenes)
    const requestedCharacters = body.characters ?? []
    const requestedScenes = body.scenes ?? []
    const replaceAll = body.replaceAll === true
    const unknownCharacterIds = requestedCharacters.filter(item => !serverCharacters.has(item.itemId)).map(item => item.itemId)
    const unknownSceneIds = requestedScenes.filter(item => !serverScenes.has(item.itemId)).map(item => item.itemId)
    if (unknownCharacterIds.length || unknownSceneIds.length) return apiError('提交内容未绑定服务端提取结果，包含未知 itemId', 422)

    const commitPromise = prisma.$transaction(async tx => {
        // Match reset/generation lock ordering. Recheck the scripts under the
        // project lock so a completed old extraction cannot reappear after reset.
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM extract_jobs WHERE id = ${jobId} FOR UPDATE`
        const lockedJob = await tx.extractJob.findUnique({ where: { id: jobId } })
        if (!lockedJob || lockedJob.phase !== 'done' || lockedJob.committedAt) throw new Error('EXTRACT_JOB_ALREADY_COMMITTED')
        const lockedScripts = await tx.episode.findMany({
            where: { projectId, deletedAt: null },
            orderBy: { episodeNumber: 'asc' },
            select: { episodeNumber: true, script: true }
        })
        if (lockedJob.activeKey !== extractionActiveKey(projectId.toString(), lockedScripts, visualStyleProfile).activeKey) throw new Error('EXTRACT_SOURCE_CHANGED')
        let removedCharacters = 0
        let removedScenes = 0
        if (replaceAll) {
            const cleared = await clearProjectExtractedEntitiesInTransaction(tx, projectId)
            removedCharacters = cleared.removedCharacters
            removedScenes = cleared.removedScenes
        }
        const allCharacters = await tx.character.findMany({ where: { projectId } })
        const allScenes = await tx.scene.findMany({ where: { projectId } })
        const existingCharacters = allCharacters.filter(character => character.deletedAt === null)
        const deletedCharacters = allCharacters.filter(character => character.deletedAt !== null)
        const existingScenes = allScenes.filter(scene => scene.deletedAt === null)
        const deletedScenes = allScenes.filter(scene => scene.deletedAt !== null)
        const replaceCharacters = replaceAll || shouldReplaceExtractedCollection(requestedCharacters)
        const replaceScenes = replaceAll || shouldReplaceExtractedCollection(requestedScenes)
        let newCharacters = 0
        let updatedCharacters = 0
        let newScenes = 0
        let updatedScenes = 0
        const newCharacterIds: bigint[] = []
        const newSceneIds: bigint[] = []
        const retainedCharacterIds = new Set<bigint>()
        const retainedSceneIds = new Set<bigint>()
        const resetCharacterVisualIds = new Set<bigint>()
        const resetSceneVisualIds = new Set<bigint>()
        const selection: Array<{ type: 'character' | 'scene'; itemId: string; mode: CommitMode; entityId?: string }> = []

        for (const request of requestedCharacters) {
            const source = serverCharacters.get(request.itemId)!
            const mode = replaceAll ? 'add' : commitMode(request.mode)
            if (mode === 'ignore') {
                selection.push({ type: 'character', itemId: request.itemId, mode })
                continue
            }
            const name = (request.name ?? source.name)?.trim()
            if (!name) throw new Error(`INVALID_CHARACTER:${request.itemId}`)
            const canonicalName = normalizeCanonicalName(name)
            const aliases = [...new Set([name, ...strings(source.aliases), ...strings(request.aliases)])]
            const aliasKeys = new Set(aliases.map(normalizeCanonicalName))
            const existing = existingCharacters.find(
                character =>
                    character.canonicalName === canonicalName ||
                    aliasKeys.has(normalizeCanonicalName(character.name)) ||
                    strings(character.aliases).some(alias => aliasKeys.has(normalizeCanonicalName(alias)))
            )
            const deletedExisting = deletedCharacters.find(
                character =>
                    character.canonicalName === canonicalName ||
                    aliasKeys.has(normalizeCanonicalName(character.name)) ||
                    strings(character.aliases).some(alias => aliasKeys.has(normalizeCanonicalName(alias)))
            )
            const incoming = {
                name,
                canonicalName,
                aliases: aliases as Prisma.InputJsonValue,
                role: request.role ?? source.role ?? null,
                gender: normalizeExtractedGender(request.gender ?? source.gender),
                age: request.age ?? source.age ?? null,
                appearancePrompt: request.appearancePrompt ?? source.appearancePrompt ?? null,
                personality: request.personality ?? source.personality ?? null,
                sourceType: 'script_extraction',
                confirmationStatus: 'confirmed'
            }
            if (!existing) {
                if (deletedExisting) {
                    const restored = await tx.character.update({
                        where: { id: deletedExisting.id },
                        data: {
                            ...incoming,
                            deletedAt: null,
                            referenceImageUrl: null,
                            referenceCandidates: null,
                            referenceAssets: Prisma.DbNull,
                            sourceVersion: { increment: 1 },
                            operationVersion: { increment: 1 }
                        }
                    })
                    existingCharacters.push(restored)
                    retainedCharacterIds.add(restored.id)
                    resetCharacterVisualIds.add(restored.id)
                    newCharacterIds.push(restored.id)
                    newCharacters += 1
                    selection.push({ type: 'character', itemId: request.itemId, mode: 'add', entityId: restored.id.toString() })
                    continue
                }
                const created = await tx.character.create({ data: { id: genId(), projectId, ...incoming } })
                existingCharacters.push(created)
                retainedCharacterIds.add(created.id)
                newCharacterIds.push(created.id)
                newCharacters += 1
                selection.push({ type: 'character', itemId: request.itemId, mode: 'add', entityId: created.id.toString() })
                continue
            }
            if (mode === 'add') throw new Error(`DUPLICATE_CHARACTER:${name}`)
            retainedCharacterIds.add(existing.id)
            const updated = await tx.character.update({
                where: { id: existing.id },
                data:
                    mode === 'overwrite'
                        ? {
                              ...incoming,
                              referenceImageUrl: null,
                              referenceCandidates: null,
                              referenceAssets: Prisma.DbNull,
                              sourceVersion: { increment: 1 },
                              operationVersion: { increment: 1 }
                          }
                        : {
                              aliases: [...new Set([...strings(existing.aliases), ...aliases])] as Prisma.InputJsonValue,
                              role: existing.role || incoming.role,
                              gender: existing.gender || incoming.gender,
                              age: existing.age || incoming.age,
                              appearancePrompt: mergeText(existing.appearancePrompt, incoming.appearancePrompt),
                              personality: mergeText(existing.personality, incoming.personality),
                              sourceVersion: { increment: 1 },
                              operationVersion: { increment: 1 }
                          }
            })
            if (mode === 'overwrite') {
                resetCharacterVisualIds.add(existing.id)
                newCharacterIds.push(existing.id)
            }
            Object.assign(existing, updated)
            updatedCharacters += 1
            selection.push({ type: 'character', itemId: request.itemId, mode, entityId: existing.id.toString() })
        }

        for (const request of requestedScenes) {
            const source = serverScenes.get(request.itemId)!
            const mode = replaceAll ? 'add' : commitMode(request.mode)
            if (mode === 'ignore') {
                selection.push({ type: 'scene', itemId: request.itemId, mode })
                continue
            }
            const name = (request.name ?? source.name)?.trim()
            if (!name) throw new Error(`INVALID_SCENE:${request.itemId}`)
            const canonicalName = normalizeCanonicalName(name)
            const aliases = [...new Set([name, ...strings(source.aliases), ...strings(request.aliases)])]
            const aliasKeys = new Set(aliases.map(normalizeCanonicalName))
            const existing = existingScenes.find(
                scene =>
                    scene.canonicalName === canonicalName || aliasKeys.has(normalizeCanonicalName(scene.name)) || strings(scene.aliases).some(alias => aliasKeys.has(normalizeCanonicalName(alias)))
            )
            const deletedExisting = deletedScenes.find(
                scene =>
                    scene.canonicalName === canonicalName || aliasKeys.has(normalizeCanonicalName(scene.name)) || strings(scene.aliases).some(alias => aliasKeys.has(normalizeCanonicalName(alias)))
            )
            const incoming = {
                name,
                canonicalName,
                aliases: aliases as Prisma.InputJsonValue,
                description: request.description ?? source.description ?? null,
                locationPrompt: request.locationPrompt ?? source.locationPrompt ?? null,
                timeOfDay: request.timeOfDay ?? source.timeOfDay ?? null,
                sourceType: 'script_extraction',
                confirmationStatus: 'confirmed'
            }
            if (!existing) {
                if (deletedExisting) {
                    const restored = await tx.scene.update({
                        where: { id: deletedExisting.id },
                        data: {
                            ...incoming,
                            deletedAt: null,
                            referenceImageUrl: null,
                            referenceCandidates: null,
                            referenceAssets: Prisma.DbNull,
                            sourceVersion: { increment: 1 },
                            operationVersion: { increment: 1 }
                        }
                    })
                    existingScenes.push(restored)
                    retainedSceneIds.add(restored.id)
                    resetSceneVisualIds.add(restored.id)
                    newSceneIds.push(restored.id)
                    newScenes += 1
                    selection.push({ type: 'scene', itemId: request.itemId, mode: 'add', entityId: restored.id.toString() })
                    continue
                }
                const created = await tx.scene.create({ data: { id: genId(), projectId, ...incoming } })
                existingScenes.push(created)
                retainedSceneIds.add(created.id)
                newSceneIds.push(created.id)
                newScenes += 1
                selection.push({ type: 'scene', itemId: request.itemId, mode: 'add', entityId: created.id.toString() })
                continue
            }
            if (mode === 'add') throw new Error(`DUPLICATE_SCENE:${name}`)
            retainedSceneIds.add(existing.id)
            const updated = await tx.scene.update({
                where: { id: existing.id },
                data:
                    mode === 'overwrite'
                        ? {
                              ...incoming,
                              referenceImageUrl: null,
                              referenceCandidates: null,
                              referenceAssets: Prisma.DbNull,
                              sourceVersion: { increment: 1 },
                              operationVersion: { increment: 1 }
                          }
                        : {
                              aliases: [...new Set([...strings(existing.aliases), ...aliases])] as Prisma.InputJsonValue,
                              description: mergeText(existing.description, incoming.description),
                              locationPrompt: mergeText(existing.locationPrompt, incoming.locationPrompt),
                              timeOfDay: existing.timeOfDay || incoming.timeOfDay,
                              sourceVersion: { increment: 1 },
                              operationVersion: { increment: 1 }
                          }
            })
            if (mode === 'overwrite') {
                resetSceneVisualIds.add(existing.id)
                newSceneIds.push(existing.id)
            }
            Object.assign(existing, updated)
            updatedScenes += 1
            selection.push({ type: 'scene', itemId: request.itemId, mode, entityId: existing.id.toString() })
        }

        // “覆盖”是当前类别的替换操作：以本次勾选入库的结果为准，移除未保留的旧数据。
        // 同时清空被覆盖条目的旧候选图，避免新 Prompt 继续沿用旧形象/旧场景。
        const obsoleteCharacterIds = findObsoleteExtractedEntityIds(existingCharacters, retainedCharacterIds, replaceCharacters)
        const obsoleteSceneIds = findObsoleteExtractedEntityIds(existingScenes, retainedSceneIds, replaceScenes)
        const invalidCharacterIds = [...new Set([...resetCharacterVisualIds, ...obsoleteCharacterIds])]
        const invalidSceneIds = [...new Set([...resetSceneVisualIds, ...obsoleteSceneIds])]
        const affectedStoryboardIds = new Set<bigint>()

        if (invalidCharacterIds.length > 0) {
            const links = await tx.storyboardCharacter.findMany({ where: { characterId: { in: invalidCharacterIds } }, select: { storyboardId: true } })
            links.forEach(link => affectedStoryboardIds.add(link.storyboardId))
            await tx.refImageJob.updateMany({
                where: { targetType: 'character', targetId: { in: invalidCharacterIds }, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } },
                data: { phase: 'cancelled', activeKey: null, error: '角色提取结果已覆盖，旧任务作废' }
            })
            await tx.characterReferenceAsset.updateMany({
                where: { characterId: { in: invalidCharacterIds }, deletedAt: null },
                data: { deletedAt: new Date() }
            })
        }
        if (obsoleteCharacterIds.length > 0) {
            await tx.storyboardCharacter.deleteMany({ where: { characterId: { in: obsoleteCharacterIds } } })
            const result = await tx.character.updateMany({
                where: { id: { in: obsoleteCharacterIds }, deletedAt: null },
                data: { deletedAt: new Date(), operationVersion: { increment: 1 } }
            })
            removedCharacters = result.count
        }

        if (invalidSceneIds.length > 0) {
            const storyboards = await tx.storyboard.findMany({ where: { sceneId: { in: invalidSceneIds }, deletedAt: null }, select: { id: true } })
            storyboards.forEach(storyboard => affectedStoryboardIds.add(storyboard.id))
            await tx.refImageJob.updateMany({
                where: { targetType: 'scene', targetId: { in: invalidSceneIds }, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } },
                data: { phase: 'cancelled', activeKey: null, error: '场景提取结果已覆盖，旧任务作废' }
            })
        }
        if (obsoleteSceneIds.length > 0) {
            await tx.storyboard.updateMany({
                where: { sceneId: { in: obsoleteSceneIds }, deletedAt: null },
                data: { sceneId: null, operationVersion: { increment: 1 } }
            })
            const result = await tx.scene.updateMany({
                where: { id: { in: obsoleteSceneIds }, deletedAt: null },
                data: { deletedAt: new Date(), operationVersion: { increment: 1 } }
            })
            removedScenes = result.count
        }

        if (affectedStoryboardIds.size > 0) {
            const storyboardIds = [...affectedStoryboardIds]
            await tx.storyboard.updateMany({ where: { id: { in: storyboardIds } }, data: { operationVersion: { increment: 1 } } })
            await tx.generation.updateMany({
                where: { storyboardId: { in: storyboardIds }, status: { in: ['queued', 'processing'] } },
                data: { status: 'cancelled', activeKey: null, errorMsg: '角色或场景提取结果已覆盖，旧任务作废' }
            })
        }

        await tx.extractJob.update({
            where: { id: jobId },
            data: { committedAt: new Date(), committedSelection: selection as Prisma.InputJsonValue, activeKey: null }
        })
        return {
            newCharacters,
            updatedCharacters,
            removedCharacters,
            newScenes,
            updatedScenes,
            removedScenes,
            newCharacterIds: [...new Set(newCharacterIds)],
            newSceneIds: [...new Set(newSceneIds)]
        }
    }, EXTRACT_COMMIT_TRANSACTION_OPTIONS)
    const result = await commitPromise.catch(error => {
        if (error instanceof Error && error.message === 'EXTRACT_SOURCE_CHANGED') return { conflict: 'source_changed' as const }
        if (error instanceof Error && error.message === 'EXTRACT_JOB_ALREADY_COMMITTED') return { conflict: 'already_committed' as const }
        if (error instanceof Error && error.message.startsWith('DUPLICATE_CHARACTER:')) {
            return { conflict: 'duplicate_character' as const, name: error.message.slice('DUPLICATE_CHARACTER:'.length) }
        }
        if (error instanceof Error && error.message.startsWith('DUPLICATE_SCENE:')) {
            return { conflict: 'duplicate_scene' as const, name: error.message.slice('DUPLICATE_SCENE:'.length) }
        }
        if (isExpiredTransactionError(error)) return { conflict: 'transaction_timeout' as const }
        throw error
    })
    if ('conflict' in result) {
        if (result.conflict === 'source_changed') return apiError('剧本已更新，旧提取结果已失效，请重新提取', 409)
        if (result.conflict === 'already_committed') return apiError('该提取任务已经提交，不能重复入库', 409)
        if (result.conflict === 'transaction_timeout') return apiError('本次入库数据较多，数据库事务超时且已安全回滚，请重试', 503)
        return apiError(`${result.conflict === 'duplicate_character' ? '角色' : '场景'}「${result.name}」已存在；请选择合并、覆盖或忽略`, 409)
    }
    return apiResponse(result)
}
