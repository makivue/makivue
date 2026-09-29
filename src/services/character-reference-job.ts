import { prisma } from '@/lib/prisma'
import { StaleReferenceMutationError, withActiveReferenceWrite } from './reference-persistence-guard'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { genId } from '@/lib/id'
import { updateJob } from '@/lib/refImageJobStore'
import { isRefImageJobRuntimeExceeded, referenceProgressAt, REF_IMAGE_HEARTBEAT_INTERVAL_MS, REF_IMAGE_JOB_MAX_RUNTIME_MS, type ReferenceGenerationProgress } from '@/lib/reference-generation-progress'
import { waitForReferenceImageSlot } from '@/lib/generation-concurrency'
import { chargeModelUsage } from '@/services/billing'
import { markReferenceDependentsStaleInTransaction } from '@/services/content-lineage'
import { generateCharacterReference, type CharacterReferenceRole, type ImageProvider } from '@/services/ai'
import type { ImageQuality } from '@/lib/image-quality'
import { characterReferenceAnimalSpecies } from '@/lib/character-reference-retry'

export interface CharacterReferenceJobInput {
    jobId: string
    characterId: bigint
    projectId: bigint
    userId: bigint
    imageProvider: ImageProvider
    imageQuality: ImageQuality
    promptVersion: string
    role: CharacterReferenceRole
    replaceSelected: boolean
    requestId?: string
    sourceOperationVersion?: number
}

export function parseCharacterReferenceCandidates(raw: string | null | undefined): string[] {
    if (!raw) return []
    try {
        const value = JSON.parse(raw)
        return Array.isArray(value) ? value.filter((candidate): candidate is string => typeof candidate === 'string') : []
    } catch {
        return []
    }
}

/** Claims the shared image slot before executing one character reference job. */
export async function runQueuedCharacterReferenceJob(input: CharacterReferenceJobInput) {
    try {
        const claimed = await waitForReferenceImageSlot({ userId: input.userId, projectId: input.projectId, jobId: BigInt(input.jobId) })
        if (claimed) await runCharacterReferenceJob(input)
    } catch (error) {
        console.error('[character-reference-job] queue failed', { jobId: input.jobId, characterId: input.characterId.toString() }, error)
        await updateJob(input.jobId, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
}

async function runCharacterReferenceJob(input: CharacterReferenceJobInput) {
    return withHiModelsUsageScope({ userId: input.userId, jobId: input.jobId }, () => executeCharacterReferenceJob(input))
}

async function executeCharacterReferenceJob({
    jobId,
    characterId,
    userId,
    imageProvider,
    imageQuality,
    promptVersion,
    role,
    replaceSelected,
    requestId,
    sourceOperationVersion
}: CharacterReferenceJobInput) {
    const startedAt = Date.now()
    let latestProgress: ReferenceGenerationProgress | undefined
    let failureStage = 'generating'
    const heartbeat = setInterval(() => {
        if (isRefImageJobRuntimeExceeded(startedAt)) {
            clearInterval(heartbeat)
            void updateJob(jobId, {
                phase: 'error',
                error: `角色参考图单项任务超时（超过 ${Math.round(REF_IMAGE_JOB_MAX_RUNTIME_MS / 60_000)} 分钟），已停止等待，请重试`
            })
            return
        }
        const progress = referenceProgressAt(latestProgress, startedAt)
        void updateJob(jobId, progress ? { result: { progress } } : {})
    }, REF_IMAGE_HEARTBEAT_INTERVAL_MS)
    try {
        await updateJob(jobId, { attempts: 1 })
        const source = await prisma.character.findFirst({
            where: { id: characterId, deletedAt: null },
            select: { projectId: true, operationVersion: true, project: { select: { operationVersion: true } } }
        })
        if (!source) throw new Error('Character not found')
        if (sourceOperationVersion !== undefined && source.operationVersion !== sourceOperationVersion) throw new StaleReferenceMutationError()
        const generated = await generateCharacterReference(characterId, {
            commit: false,
            provider: imageProvider,
            quality: imageQuality,
            role,
            generationNonce: requestId ?? jobId,
            onProgress: async progress => {
                latestProgress = progress
                failureStage = progress.stage
                await updateJob(jobId, { result: { progress } })
            }
        })
        const url = generated.url
        const actualProvider = generated.generation.actualProvider
        failureStage = 'writing_db'
        await updateJob(jobId, { phase: 'writing_db' })
        const { candidates, referenceImageUrl } = await withActiveReferenceWrite(
            { type: 'character', id: characterId, ...source, jobId, projectOperationVersion: source.project.operationVersion },
            async tx => {
                const character = await tx.character.findFirst({ where: { id: characterId, deletedAt: null } })
                if (!character) throw new Error('Character not found')
                const animalSpecies = characterReferenceAnimalSpecies(
                    [character.name, character.canonicalName, character.role, character.personality, character.appearancePrompt].filter(Boolean).join('\n')
                )
                const replacingLegacyAnimalSheets = replaceSelected && role === 'turnaround_sheet' && Boolean(animalSpecies) && /turnaround-sheet-v(?:1[2-9]|[2-9]\d)/.test(promptVersion)
                const existingSelected = await tx.characterReferenceAsset.findFirst({
                    where: {
                        characterId,
                        role,
                        stateKey: null,
                        status: 'selected',
                        deletedAt: null
                    },
                    select: { id: true }
                })
                const currentCandidates = replacingLegacyAnimalSheets ? [] : parseCharacterReferenceCandidates(character.referenceCandidates)
                const candidates = role === 'turnaround_sheet' ? [url, ...currentCandidates.filter(candidate => candidate !== url)].slice(0, 8) : currentCandidates
                const shouldSelect = replaceSelected || (!existingSelected && !(role === 'turnaround_sheet' && character.referenceImageUrl))
                const referenceImageUrl = role === 'turnaround_sheet' && shouldSelect ? url : character.referenceImageUrl
                const primarySheetChanged = role === 'turnaround_sheet' && shouldSelect && character.referenceImageUrl !== url
                if (replaceSelected) {
                    if (replacingLegacyAnimalSheets) {
                        await tx.characterReferenceAsset.updateMany({
                            where: { characterId, role, stateKey: null, deletedAt: null },
                            data: { status: 'candidate', deletedAt: new Date() }
                        })
                    } else {
                        await tx.characterReferenceAsset.updateMany({
                            where: { characterId, role, stateKey: null, status: 'selected', deletedAt: null },
                            data: { status: 'candidate' }
                        })
                    }
                }
                if (role === 'turnaround_sheet') {
                    await tx.character.update({
                        where: { id: characterId },
                        data: {
                            referenceCandidates: JSON.stringify(candidates),
                            referenceImageUrl,
                            ...(primarySheetChanged ? { sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } } : {})
                        }
                    })
                }
                await tx.characterReferenceAsset.create({
                    data: {
                        id: genId(),
                        characterId,
                        role,
                        url,
                        status: shouldSelect ? 'selected' : 'candidate',
                        provider: actualProvider,
                        promptVersion,
                        sourceVersion: character.sourceVersion + (primarySheetChanged ? 1 : 0)
                    }
                })
                if (replaceSelected || primarySheetChanged) {
                    await markReferenceDependentsStaleInTransaction(tx, { type: 'character', id: characterId, projectId: character.projectId }, '角色参考图已全部重新生成，请重新生成关联分镜帧和视频')
                }

                await chargeModelUsage({
                    tx,
                    userId,
                    idempotencyKey: `usage:reference-job:${jobId}`,
                    sourceType: 'reference_job',
                    sourceId: jobId,
                    description: ['角色参考图', actualProvider].join(' · '),
                    metadata: {
                        targetType: 'character',
                        targetId: characterId.toString(),
                        provider: actualProvider,
                        requestedProvider: imageProvider,
                        role
                    }
                })
                return { candidates, referenceImageUrl }
            }
        )
        failureStage = 'billing'

        failureStage = 'completing'
        await updateJob(jobId, {
            phase: 'done',
            result: {
                targetType: 'character',
                targetId: characterId.toString(),
                candidateUrl: url,
                referenceImageUrl,
                referenceCandidates: candidates,
                provider: actualProvider,
                requestedProvider: imageProvider,
                recovery: generated.generation.recovery,
                fallbackReason: generated.generation.fallbackReason,
                providerSwitch: generated.generation.providerSwitch,
                inspectionWarning: generated.generation.inspectionWarning,
                promptVersion,
                role,
                timings: latestProgress
                    ? { ...latestProgress.timings, totalMs: Date.now() - startedAt }
                    : { generationMs: 0, inspectionMs: 0, uploadMs: 0, totalMs: Date.now() - startedAt, retryCount: 0 }
            }
        })
    } catch (error) {
        // Keep the original Error object so server logs include its stack/cause;
        // the browser receives only the existing user-facing message.
        console.error('[character-reference-job] failed', { jobId, characterId: characterId.toString(), provider: imageProvider, stage: failureStage }, error)
        await updateJob(jobId, {
            phase: 'error',
            error: error instanceof Error ? error.message : String(error)
        })
    } finally {
        clearInterval(heartbeat)
    }
}
