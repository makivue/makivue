export type ImageGenerationRecovery = 'safety_rewrite' | 'fallback_provider'

import type { HiModelsImageModel } from './himodels-models'

export type ImageGenerationProvider = 'banana' | 'doubao' | 'qwen-image-3.0-pro' | HiModelsImageModel

export type ImageProviderSwitch = {
    from: ImageGenerationProvider
    to: ImageGenerationProvider
    reason: string
    status?: number
    attempts?: number
    contentLabel?: string
}

export type ImageGenerationResult = {
    requestedProvider: ImageGenerationProvider
    initialProvider: ImageGenerationProvider
    actualProvider: ImageGenerationProvider
    recovery?: ImageGenerationRecovery
    safetyRewriteCount: number
    referenceImagesApplied: boolean
    fallbackReason?: string
    providerSwitch?: ImageProviderSwitch
    inspectionWarning?: string
    usage?: Record<string, number | string | boolean> | null
}

export function shouldUseAutomaticImageFallback(error: unknown, provider: string, enabled: boolean): boolean {
    return enabled && provider === 'banana' && !!error && typeof error === 'object' && 'code' in error && error.code === 'BANANA_IMAGE_SAFETY'
}

export class ImageRecoveryExhaustedError extends Error {
    readonly code = 'IMAGE_RECOVERY_EXHAUSTED'

    constructor(
        message: string,
        readonly details?: Record<string, unknown>,
        options?: ErrorOptions
    ) {
        super(message, options)
        this.name = 'ImageRecoveryExhaustedError'
    }
}

export class ImageProviderTimeoutError extends Error {
    readonly code = 'IMAGE_PROVIDER_TIMEOUT'

    constructor(
        readonly provider: ImageGenerationProvider,
        readonly timeoutMs: number,
        readonly contentLabel?: string
    ) {
        super(`${contentLabel ? `“${contentLabel}”` : '当前图片'}生成超时（>${Math.round(timeoutMs / 1000)} 秒）`)
        this.name = 'ImageProviderTimeoutError'
    }
}
