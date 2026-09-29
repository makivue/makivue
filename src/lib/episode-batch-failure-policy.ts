import { getGenerationErrorGuidance, type GenerationErrorKind } from './generation-error-guidance'

export const EPISODE_BATCH_REPEATED_FAILURE_LIMIT = 3

export type EpisodeBatchFailurePresentation = {
    message: string
    circuitKey?: Extract<GenerationErrorKind, 'content_safety' | 'translation' | 'storage_permission' | 'credentials'>
}

export function presentEpisodeBatchFailure(error: unknown): EpisodeBatchFailurePresentation {
    const raw = error instanceof Error ? error.message : String(error)
    const guidance = getGenerationErrorGuidance(raw)
    const message = guidance.kind === 'queue_full' ? raw : `${guidance.title}：${guidance.nextStep}`

    if (
        guidance.kind === 'content_safety'
        && /InputImageSensitiveContentDetected\.PrivacyInformation|PrivacyInformation|input image may contain real person|真人认证|真人素材|人像认证|本镜没有关联角色|官方 AIGC 素材库.*仍判定/i.test(raw)
    ) {
        return { message, circuitKey: 'content_safety' }
    }
    if (guidance.kind === 'translation' || guidance.kind === 'storage_permission' || guidance.kind === 'credentials') {
        return { message, circuitKey: guidance.kind }
    }
    return { message }
}

export function repeatedEpisodeBatchFailureMessage(presentation: EpisodeBatchFailurePresentation): string {
    return `相同原因已连续失败 ${EPISODE_BATCH_REPEATED_FAILURE_LIMIT} 个镜头，已停止其余视频任务，避免整批重复失败。${presentation.message}`
}
