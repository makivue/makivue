import { getImageQualityOption, getNanoBananaImageSize, getQwenImageSize, normalizeImageQuality, type ImageQuality, type QwenImageAspectRatio } from '@/lib/image-quality'
import { NANO_BANANA_IMAGE_MODEL, NANO_BANANA_LOCATION } from '@/lib/gemini-models'
import { getHiModelsImageModelCapability, isHiModelsImageModel, type HiModelsImageApiModel } from '@/lib/himodels-models'
import { getImageProviderCapability, resolveImagePromptChannels, type ProductionImageProvider } from '@/lib/provider-capabilities'
import { quoteModelRequestReservation } from '@/services/model-call-billing'
import { buildHiModelsImageRequest } from '@/services/himodels'
import { QWEN_IMAGE_3_PRO_MODEL } from '@/services/qwen-image'

type ImageAspectRatio = '1:1' | '21:9' | '16:9' | '9:16' | '4:3' | '3:4'

type ImageReservationQuoteInput = {
    provider: ProductionImageProvider
    prompt: string
    negativePrompt?: string
    referenceCount: number
    aspectRatio: ImageAspectRatio
    quality: ImageQuality
}

function effectiveProvider(provider: ProductionImageProvider, referenceCount: number): ProductionImageProvider {
    const capability = getImageProviderCapability(provider)
    return referenceCount > 0 && capability?.maxImageReferences === 0 ? 'banana' : provider
}

function placeholderGeminiReferences(count: number) {
    return Array.from({ length: count }, () => ({ inlineData: { mimeType: 'image/png', data: '' } }))
}

/** Mirrors the billable provider request without loading images or contacting the provider. */
export async function quoteImageGenerationReservationPoints(input: ImageReservationQuoteInput): Promise<number> {
    const quality = normalizeImageQuality(input.quality)
    const provider = effectiveProvider(input.provider, input.referenceCount)
    const capability = getImageProviderCapability(provider)
    const referenceCount = Math.min(input.referenceCount, capability?.maxImageReferences ?? 0)
    const channels = resolveImagePromptChannels(provider, input.prompt, input.negativePrompt)
    const prompt = [channels.prompt, getImageQualityOption(quality).promptSuffix].filter(Boolean).join(', ')

    if (provider === 'banana') {
        const model = process.env.NANO_BANANA_MODEL ?? NANO_BANANA_IMAGE_MODEL
        const location = process.env.NANO_BANANA_LOCATION ?? NANO_BANANA_LOCATION
        const body = {
            contents: [{ role: 'user', parts: [...placeholderGeminiReferences(referenceCount), { text: prompt }] }],
            generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: input.aspectRatio, imageSize: getNanoBananaImageSize(quality) }
            }
        }
        const url = `https://aiplatform.googleapis.com/v1/projects/quote/locations/${location}/publishers/google/models/${model}:generateContent`
        const quote = await quoteModelRequestReservation('gemini', model, url, body)
        return Math.ceil(quote.reservationPoints)
    }

    if (provider === 'qwen-image-3.0-pro') {
        const aspectRatio = input.aspectRatio === '21:9' ? '16:9' : input.aspectRatio
        const references = Array.from({ length: referenceCount }, (_, index) => ({ image: `reference-${index + 1}` }))
        const body = {
            model: QWEN_IMAGE_3_PRO_MODEL,
            input: { messages: [{ role: 'user', content: [...references, { text: prompt }] }] },
            parameters: {
                size: getQwenImageSize(quality, aspectRatio as QwenImageAspectRatio),
                n: 1,
                prompt_extend: true,
                enable_thinking: quality !== 'standard',
                watermark: false,
                ...(channels.negativePrompt ? { negative_prompt: channels.negativePrompt } : {})
            }
        }
        const baseUrl = (process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com').replace(/\/$/, '')
        const quote = await quoteModelRequestReservation('qwen', QWEN_IMAGE_3_PRO_MODEL, `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, body)
        return Math.ceil(quote.reservationPoints)
    }

    const model: HiModelsImageApiModel = provider === 'doubao' ? 'seedream-5-0-lite' : provider
    if (!isHiModelsImageModel(model)) throw new Error('图片模型无效')
    const body = buildHiModelsImageRequest({
        model,
        prompt,
        aspectRatio: input.aspectRatio,
        imageSize: quality === 'ultra' ? '4K' : quality === 'clear' ? '2K' : '1K',
        referenceParts: placeholderGeminiReferences(Math.min(referenceCount, getHiModelsImageModelCapability(model).maxReferenceImages))
    })
    const baseUrl = (process.env.HIMODELS_BASE_URL?.trim() || 'https://api.himodels.ai').replace(/\/$/, '')
    const quote = await quoteModelRequestReservation('himodels', model, `${baseUrl}/v1/images/generations`, body)
    return Math.ceil(quote.reservationPoints)
}

export function calculateAffordableBatch<T extends { id: string; reservationPoints: number }>(items: readonly T[], balancePoints: number) {
    const affordableItems: T[] = []
    let affordablePoints = 0
    for (const item of items) {
        if (affordablePoints + item.reservationPoints > balancePoints) break
        affordableItems.push(item)
        affordablePoints += item.reservationPoints
    }
    return {
        affordableItems,
        affordablePoints,
        requiredPoints: items.reduce((sum, item) => sum + item.reservationPoints, 0),
        minimumPoints: items.length > 0 ? Math.min(...items.map(item => item.reservationPoints)) : 0
    }
}
