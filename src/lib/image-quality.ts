export const IMAGE_QUALITY_OPTIONS = [
    {
        value: 'standard',
        label: '标准',
        desc: '速度和成本优先，适合批量预览',
        promptSuffix: 'clean image, readable facial features, natural details, no blur, no compression artifacts'
    },
    {
        value: 'clear',
        label: '清晰',
        desc: '增强脸部、手部和主体细节，推荐正式生成',
        promptSuffix: 'sharp facial features, clean hands, crisp subject edges, detailed textures, refined lighting, no blur, no artifacts'
    },
    {
        value: 'ultra',
        label: '超清',
        desc: '最高细节倾向，耗时和失败风险可能更高',
        promptSuffix: 'ultra sharp image, high-detail face and eyes, clean hands, crisp fabric texture, precise background details, premium cinematic still, no blur, no artifacts'
    }
] as const

export type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number]['value']
export type NanoBananaImageSize = '1K' | '2K' | '4K'
export type ImageQualityProvider = ProductionImageProvider
export type QwenImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

// Qwen Image 3.0 Pro accepts freely selected dimensions whose pixel area is
// between 512² and 2048². These tiers preserve each requested aspect ratio and
// make the product's three quality choices materially different.
const QWEN_IMAGE_SIZES: Record<ImageQuality, Record<QwenImageAspectRatio, string>> = {
    standard: {
        '1:1': '1024*1024',
        '16:9': '1344*768',
        '9:16': '768*1344',
        '4:3': '1184*896',
        '3:4': '896*1184'
    },
    clear: {
        '1:1': '1536*1536',
        '16:9': '2048*1152',
        '9:16': '1152*2048',
        '4:3': '1792*1344',
        '3:4': '1344*1792'
    },
    ultra: {
        '1:1': '2048*2048',
        '16:9': '2688*1536',
        '9:16': '1536*2688',
        '4:3': '2368*1728',
        '3:4': '1728*2368'
    }
}

export function normalizeImageQuality(value: unknown): ImageQuality {
    return value === 'clear' || value === 'ultra' || value === 'standard' ? value : 'standard'
}

export function getImageQualityOption(value: unknown) {
    const normalized = normalizeImageQuality(value)
    return IMAGE_QUALITY_OPTIONS.find(option => option.value === normalized) ?? IMAGE_QUALITY_OPTIONS[0]
}

export function getNanoBananaImageSize(value: unknown): NanoBananaImageSize {
    const quality = normalizeImageQuality(value)
    if (quality === 'ultra') return '4K'
    if (quality === 'clear') return '2K'
    return '1K'
}

export function getQwenImageSize(quality: ImageQuality, aspectRatio: QwenImageAspectRatio): string {
    return QWEN_IMAGE_SIZES[normalizeImageQuality(quality)][aspectRatio]
}

function qwenResolutionDetail(quality: ImageQuality): string {
    const sizes = QWEN_IMAGE_SIZES[normalizeImageQuality(quality)]
    return `1:1 ${sizes['1:1'].replace('*', '×')} / 16:9 ${sizes['16:9'].replace('*', '×')} / 9:16 ${sizes['9:16'].replace('*', '×')} / 4:3 ${sizes['4:3'].replace('*', '×')} / 3:4 ${sizes['3:4'].replace('*', '×')}`
}

export function getImageResolutionLabel(provider: ImageQualityProvider, quality: ImageQuality): string {
    if (provider === 'doubao' || (isHiModelsImageModel(provider) && getHiModelsImageModelCapability(provider).supportedImageSizes.length === 1)) return '2K'
    if (provider === 'qwen-image-3.0-pro') return quality === 'ultra' ? '2K' : quality === 'clear' ? '1.5K' : '1K'
    return getNanoBananaImageSize(quality)
}

export function getImageResolutionDetail(provider: ImageQualityProvider, quality: ImageQuality): string {
    if (provider === 'doubao' || (isHiModelsImageModel(provider) && getHiModelsImageModelCapability(provider).supportedImageSizes.length === 1))
        return `2K（由 ${provider === 'doubao' ? 'Seedream 5.0 Lite' : modelDisplayName(provider)} 按画面比例生成）`
    if (provider === 'qwen-image-3.0-pro') return qwenResolutionDetail(quality)
    return getNanoBananaImageSize(quality)
}
import { getHiModelsImageModelCapability, isHiModelsImageModel } from './himodels-models'
import { modelDisplayName } from './model-display'
import type { ProductionImageProvider } from './provider-capabilities'
