import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertProjectOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { isImageProvider, resolveCharacterReferenceRuntimePolicy, type CharacterReferenceRole, type ImageProvider } from '@/services/ai'
import { normalizeImageQuality } from '@/lib/image-quality'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { assertNanoBananaCredentialsConfigured, NanoBananaConfigurationError } from '@/services/banana'
import { buildCharacterTurnaroundPromptVersion } from '@/lib/character-reference-retry'
import { createJob as createRefImageJob, updateJob as updateRefImageJob } from '@/lib/refImageJobStore'
import { createJob as createProjectJob, updateJob as updateProjectJob } from '@/lib/projectAiJobStore'
import { REFERENCE_BATCH_CONCURRENCY } from '@/lib/reference-generation-progress'
import { runCharacterReferenceBatchJob, type CharacterReferenceBatchItem, type CharacterReferenceBatchPayload } from '@/services/character-reference-batch'
import type { CharacterReferenceJobInput } from '@/services/character-reference-job'

type Params = { params: Promise<{ id: string }> }
type RequestedTask = { characterId: string; role: CharacterReferenceRole }

export const maxDuration = 1800
const MAX_CHARACTER_REFERENCE_BATCH_SIZE = 50

function characterReferenceRole(value: unknown): CharacterReferenceRole | null {
    return value === undefined || value === null || value === 'turnaround_sheet' ? 'turnaround_sheet' : null
}

function parseTasks(value: unknown): RequestedTask[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHARACTER_REFERENCE_BATCH_SIZE) return null
    const tasks: RequestedTask[] = []
    const seen = new Set<string>()
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') return null
        const characterId = typeof (raw as { characterId?: unknown }).characterId === 'string' ? (raw as { characterId: string }).characterId : ''
        const parsedId = parseApiId(characterId)
        const role = characterReferenceRole((raw as { role?: unknown }).role)
        if (parsedId === null || !role) return null
        const key = `${parsedId}:${role}`
        if (seen.has(key)) continue
        seen.add(key)
        tasks.push({ characterId: parsedId.toString(), role })
    }
    return tasks.length > 0 ? tasks : null
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const body = await req.json().catch(() => ({}))
    const requestedTasks = parseTasks(body.tasks)
    if (!requestedTasks) return apiError(`tasks 必须包含 1-${MAX_CHARACTER_REFERENCE_BATCH_SIZE} 个有效角色任务`, 400)
    const characterIds = requestedTasks.map(task => BigInt(task.characterId))
    const characters = await prisma.character.findMany({
        where: { id: { in: characterIds }, projectId, deletedAt: null },
        select: { id: true, appearancePrompt: true, operationVersion: true }
    })
    const characterById = new Map(characters.map(character => [character.id.toString(), character]))
    const missingCharacter = requestedTasks.find(task => !characterById.has(task.characterId))
    if (missingCharacter) return apiError(`角色 ${missingCharacter.characterId} 不属于当前项目或已删除`, 400)
    const promptMissing = requestedTasks.find(task => !characterById.get(task.characterId)?.appearancePrompt?.trim())
    if (promptMissing) return apiError(`角色 ${promptMissing.characterId} 缺少外观提示词`, 400)

    const imageProvider: ImageProvider | undefined = isImageProvider(body.provider) ? body.provider : undefined
    const imageQuality = normalizeImageQuality(body.imageQuality)
    const replaceSelected = body.replaceSelected === true

    try {
        const taskPolicy = await resolveCharacterReferenceRuntimePolicy(projectId, imageProvider)
        const taskProvider = taskPolicy.provider
        const promptVersion = buildCharacterTurnaroundPromptVersion(taskPolicy.promptVersion)
        if (taskProvider === 'banana') assertNanoBananaCredentialsConfigured()
        await assertSufficientPoints(userId, quoteGenerationPoints('reference', taskProvider))

        const parentJob = await createProjectJob(projectId.toString(), 'character_references', requestedTasks.length)
        if (parentJob.reused) return apiResponse({ jobId: parentJob.id, resumed: true }, 202)

        const createdChildJobIds: string[] = []
        try {
            const items: CharacterReferenceBatchItem[] = []
            const tasks: CharacterReferenceJobInput[] = []
            for (const requestedTask of requestedTasks) {
                const childJob = await createRefImageJob('character', requestedTask.characterId, projectId.toString(), {
                    promptVersion,
                    provider: taskProvider,
                    quality: imageQuality,
                    role: requestedTask.role,
                    mode: replaceSelected ? 'replace-selected' : 'candidate'
                })
                if (!childJob.reused) createdChildJobIds.push(childJob.id)
                items.push({ jobId: childJob.id, characterId: requestedTask.characterId, role: requestedTask.role })
                tasks.push({
                    jobId: childJob.id,
                    characterId: BigInt(requestedTask.characterId),
                    projectId,
                    userId,
                    imageProvider: taskProvider,
                    imageQuality,
                    promptVersion,
                    role: requestedTask.role,
                    replaceSelected,
                    sourceOperationVersion: characterById.get(requestedTask.characterId)?.operationVersion
                })
            }
            const payload: CharacterReferenceBatchPayload = {
                items,
                concurrency: Math.min(REFERENCE_BATCH_CONCURRENCY, items.length),
                quality: imageQuality,
                replaceSelected,
                mode: body.mode === 'all' ? 'all' : 'missing'
            }
            await updateProjectJob(parentJob.id, { result: payload })
            after(() => withHiModelsUsageScope({ userId, jobId: parentJob.id }, () => runCharacterReferenceBatchJob(parentJob.id, payload, tasks)))
            return apiResponse({ jobId: parentJob.id, resumed: false, total: items.length, concurrency: payload.concurrency }, 202)
        } catch (error) {
            await Promise.all(createdChildJobIds.map(jobId => updateRefImageJob(jobId, { phase: 'error', error: '角色参考图批次创建失败，请重试' })))
            await updateProjectJob(parentJob.id, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
            throw error
        }
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        if (error instanceof NanoBananaConfigurationError) return apiError(`Nano Banana 部署凭据不可用：${error.message}`, 503)
        return apiError(error instanceof Error ? error.message : String(error), 500)
    }
}
