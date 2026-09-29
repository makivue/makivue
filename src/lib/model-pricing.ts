import { Prisma } from '@/generated/prisma/client'
import type { TokenUsageProvider } from './himodels-token-usage'
import { extractApiTokenUsage } from './api-token-usage'
import { SEEDANCE_20_ENDPOINT_ID, SEEDANCE_25_ENDPOINT_ID } from './provider-capabilities'

export type ModelPrice = {
    version: string
    source: string
    currency: 'USD' | 'CNY'
    kind: 'text' | 'image_tokens' | 'images' | 'video_tokens' | 'video_seconds'
    input?: number
    output?: number
    cachedInput?: number
    imageOutput?: number
    inputImage?: number
    includedInputImages?: number
    outputImage?: number
    outputImage2k?: number
    requireImageTier?: boolean
    second?: number
    longInput?: number
    longOutput?: number
    longCachedInput?: number
    longContextThreshold?: number
    /** Locked at dispatch: one unit of the supplier's currency in USD. */
    usdPerCurrency?: number
}

export type ModelRequestMeter = {
    resolution: string
    inputImages: number
    inputVideoSeconds: number
    hasInputVideo: boolean
    duration: number
    outputImages: number
    maxOutputTokens: number
    inputTokenBudget: number
}

type Obj = Record<string, unknown>
export function modelRecord(value: unknown): Obj {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {}
}
function count(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
}
function numberAt(object: Obj, ...keys: string[]): number | null {
    for (const key of keys) {
        const n = count(key.split('.').reduce<unknown>((v, part) => modelRecord(v)[part], object))
        if (n !== null) return n
    }
    return null
}

/** Store counters only; never persist prompts, image bytes, URLs or credentials. */
export function meterModelRequest(body: unknown): ModelRequestMeter {
    const request = modelRecord(body),
        parameters = modelRecord(request.parameters),
        config = modelRecord(request.generationConfig)
    let inputImages = 0,
        inputVideoSeconds = 0,
        hasInputVideo = false,
        textBytes = 0
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit)
            return
        }
        if (!value || typeof value !== 'object') return
        const o = modelRecord(value)
        if (o.type === 'video_url' || o.video_url) hasInputVideo = true
        if (o.type === 'image_url' || o.image || o.inlineData || o.inline_data || o.fileData || o.file_data) inputImages++
        for (const [key, item] of Object.entries(o)) {
            if (typeof item === 'string' && ['text', 'content', 'prompt'].includes(key)) textBytes += Buffer.byteLength(item, 'utf8')
            else if (typeof item === 'object' && !['inlineData', 'inline_data', 'fileData', 'file_data', 'image_url', 'video_url'].includes(key)) visit(item)
        }
    }
    visit(body)
    // Seedream's image argument is an array of reference URLs.
    if (Array.isArray(request.image)) inputImages = request.image.length
    const resolution = String(request.resolution ?? parameters.resolution ?? modelRecord(config.imageConfig).imageSize ?? parameters.size ?? '720p').toLowerCase()
    inputVideoSeconds = numberAt(request, 'input_video_duration') ?? 0
    return {
        resolution,
        inputImages,
        inputVideoSeconds,
        hasInputVideo,
        duration: numberAt(request, 'duration') ?? numberAt(parameters, 'duration') ?? 0,
        outputImages: numberAt(parameters, 'n') ?? numberAt(request, 'n') ?? 1,
        maxOutputTokens: numberAt(request, 'max_tokens', 'max_output_tokens', 'max_completion_tokens') ?? numberAt(config, 'maxOutputTokens') ?? 32768,
        // UTF-8 bytes bound tokenization more conservatively than character/4.
        inputTokenBudget: textBytes + inputImages * 4096 + 1024
    }
}

const GOOGLE = 'https://cloud.google.com/vertex-ai/generative-ai/pricing'
const ARK = 'https://www.volcengine.com/docs/82379/1544106'
const ALI = 'https://help.aliyun.com/zh/model-studio/model-pricing'
const HI = 'https://himodels.ai/console/model-marketplace'
const OPENAI = 'https://developers.openai.com/api/docs/pricing'
const AZURE = 'https://azure.microsoft.com/en-us/pricing/details/azure-openai/'

/** Supplier prices, never product markups. Each channel has a separate catalog. */
export function resolveModelPrice(provider: TokenUsageProvider, modelValue: string, meter: ModelRequestMeter, url: string, at = new Date()): ModelPrice | null {
    const model = modelValue.replace(/^gemini:/, '')
    const base = (source: string, currency: ModelPrice['currency'], kind: ModelPrice['kind'], rates: Partial<ModelPrice>): ModelPrice => ({ version: '2026-09-11', source, currency, kind, ...rates })
    const overrides = process.env.MODEL_COST_RATES_JSON
    if (overrides) {
        const values = JSON.parse(overrides) as Record<string, ModelPrice>
        const override = values[`${provider}:${model}:${meter.resolution}:${meter.hasInputVideo ? 'video' : 'no-video'}`] ?? values[`${provider}:${model}`]
        if (override) return validatePrice(override)
    }
    if (provider === 'himodels') {
        if (model === 'gemini-3.7-flash') return base(HI, 'USD', 'text', { input: 1.5, output: 9, cachedInput: 0.15 })
        if (model === 'gemini-3.1-flash-image') return base(HI, 'USD', 'image_tokens', { input: 0.5, output: 3, imageOutput: 60 })
        if (model === 'seedream-5-0-lite') return base(HI, 'USD', 'images', { inputImage: 0, outputImage: 0.04 })
        if (model === 'seedance-2.0-global') {
            const rates: Record<string, [number, number]> = { '480p': [7, 4.3], '720p': [7, 4.3], '1080p': [7.7, 4.7], '4k': [4, 2.4] }
            const rate = rates[meter.resolution]
            return rate ? base(HI, 'USD', 'video_tokens', { output: rate[meter.hasInputVideo ? 1 : 0] }) : null
        }
        if (model === 'seedance-2.5-global') {
            // Independently published 2.5 USD prices (2026-09-11 screenshot).
            // Listed dollar rates are used once; a contract discount belongs in
            // the channel override, never in the USD-to-coins conversion.
            const rates: Record<string, [number, number]> = { '480p': [10.7, 6.4], '720p': [10.7, 6.4], '1080p': [11.7, 7] }
            const rate = rates[meter.resolution]
            return rate ? base(`${HI}?spuCode=seedance-2.5-global`, 'USD', 'video_tokens', { output: rate[meter.hasInputVideo ? 1 : 0] }) : null
        }
        if (model === 'MiniMax-H3') {
            const second = meter.resolution === '768p' ? 0.08 : ['1440p', '2k'].includes(meter.resolution) ? 0.13 : null
            return second === null ? null : base(`${HI}?spuCode=MiniMax-H3`, 'USD', 'video_seconds', { second, inputImage: 0.04, includedInputImages: 5 })
        }
        return null
    }
    if (provider === 'gemini') {
        const regional = /\/locations\/(?!global(?:\/|$))[^/]+/.test(url)
        const factor = regional ? 1.1 : 1
        if (model === 'gemini-3.7-flash') {
            const introductory = at < new Date('2027-01-01T00:00:00Z')
            return base(GOOGLE, 'USD', 'text', {
                version: introductory ? '2026-09-11-intro' : '2027-01-01',
                input: (introductory ? 0.75 : 1.5) * factor,
                output: (introductory ? 3.75 : 7.5) * factor,
                cachedInput: (introductory ? 0.075 : 0.15) * factor
            })
        }
        if (model === 'gemini-3.1-flash-image') return base(GOOGLE, 'USD', 'image_tokens', { input: 0.5 * factor, output: 3 * factor, imageOutput: 60 * factor, cachedInput: 0.05 * factor })
        if (model === 'gemini-2.5-pro') {
            return base(GOOGLE, 'USD', 'text', { input: 1.25, output: 10, cachedInput: 0.125, longInput: 2.5, longOutput: 15, longCachedInput: 0.25 })
        }
    }
    if (provider === 'openai' && new URL(url).hostname === 'api.openai.com') {
        if (model === 'gpt-4o') return base(OPENAI, 'USD', 'text', { input: 2.5, output: 10, cachedInput: 1.25 })
        if (model === 'gpt-5.4') return base(OPENAI, 'USD', 'text', { input: 2.5, output: 15, cachedInput: 0.25, longContextThreshold: 272000, longInput: 5, longOutput: 22.5, longCachedInput: 0.5 })
    }
    if (provider === 'azure-openai' && new URL(url).hostname.endsWith('.openai.azure.com') && ['gpt-5.4', 'gpt-5.4-shortdrama'].includes(model)) {
        // Global Standard is the default public tariff, not a verified private
        // deployment contract. Other tiers require a channel-specific override.
        return base(AZURE, 'USD', 'text', { input: 2.5, output: 15, cachedInput: 0.25, longContextThreshold: 272000, longInput: 5, longOutput: 22.5, longCachedInput: 0.5 })
    }
    if (provider === 'volcengine' && new URL(url).hostname === 'ark.cn-beijing.volces.com') {
        const is25 = [SEEDANCE_25_ENDPOINT_ID, process.env.SEEDANCE_25_MODEL, 'doubao-seedance-2.5'].includes(model)
        const is20 = [SEEDANCE_20_ENDPOINT_ID, process.env.SEEDANCE_20_MODEL, 'doubao-seedance-2.0'].includes(model)
        const rates: Record<string, [number, number]> = is25
            ? { '480p': [70, 42], '720p': [70, 42], '1080p': [77, 46] }
            : is20
              ? { '480p': [46, 28], '720p': [46, 28], '1080p': [51, 31], '4k': [26, 16] }
              : {}
        const rate = rates[meter.resolution]
        const promo = is25 && meter.resolution === '1080p' && at >= new Date('2026-08-14T06:00:00Z') && at < new Date('2026-09-17T06:00:00Z') ? 0.72 : 1
        return rate ? base(ARK, 'CNY', 'video_tokens', { output: new Prisma.Decimal(rate[meter.hasInputVideo ? 1 : 0]).times(promo).toNumber() }) : null
    }
    if (provider === 'qwen') {
        const domestic = new URL(url).hostname === 'dashscope.aliyuncs.com'
        const singapore = new URL(url).hostname === 'dashscope-intl.aliyuncs.com'
        if (!domestic && !singapore) return null
        const currency = domestic ? 'CNY' : 'USD'
        if (model === 'qwen-image-3.0-pro') {
            // Qwen reports qima_output_1k / qima_output_2k in its actual usage.
            // Reserve the larger tier; never infer a billable tier from pixels.
            return base(ALI, currency, 'images', { inputImage: domestic ? 0.02 : 0.003, outputImage: domestic ? 0.25 : 0.04, outputImage2k: domestic ? 0.5 : 0.075, requireImageTier: true })
        }
        if (model === 'wan3.0-video' || model === 'wan3.0-video-prime') {
            const prime = model.endsWith('-prime')
            const rates: Record<string, number> = domestic
                ? prime
                    ? { '480p': 0.45, '720p': 0.9, '1080p': 1.8 }
                    : { '480p': 0.21, '720p': 0.42, '1080p': 0.84 }
                : prime
                  ? { '480p': 0.068, '720p': 0.14, '1080p': 0.28 }
                  : { '480p': 0.035, '720p': 0.07, '1080p': 0.14 }
            return rates[meter.resolution] ? base(ALI, currency, 'video_seconds', { second: rates[meter.resolution] }) : null
        }
    }
    return null
}

function validatePrice(price: ModelPrice): ModelPrice {
    if (!price || !['USD', 'CNY'].includes(price.currency) || !['text', 'image_tokens', 'images', 'video_tokens', 'video_seconds'].includes(price.kind) || !price.version || !price.source)
        throw new Error('模型成本价格配置无效')
    for (const key of [
        'input',
        'output',
        'cachedInput',
        'imageOutput',
        'inputImage',
        'includedInputImages',
        'outputImage',
        'outputImage2k',
        'second',
        'usdPerCurrency',
        'longInput',
        'longOutput',
        'longCachedInput',
        'longContextThreshold'
    ] as const) {
        if (price[key] !== undefined && (!Number.isFinite(price[key]) || price[key]! < 0)) throw new Error('模型成本价格不能为负数或非有限数')
    }
    const required =
        price.kind === 'images'
            ? [price.inputImage, price.outputImage]
            : price.kind === 'video_seconds'
              ? [price.second]
              : price.kind === 'video_tokens'
                ? [price.output]
                : price.kind === 'image_tokens'
                  ? [price.input, price.output, price.imageOutput]
                  : [price.input, price.output]
    if (required.some(value => value === undefined)) throw new Error('模型成本价格缺少必要计费项')
    return price
}

export function modelBudgetUsd(price: ModelPrice, meter: ModelRequestMeter): number {
    let amount: Prisma.Decimal
    if (price.kind === 'images')
        amount = new Prisma.Decimal(price.inputImage ?? 0).times(meter.inputImages).plus(new Prisma.Decimal(Math.max(price.outputImage ?? 0, price.outputImage2k ?? 0)).times(meter.outputImages))
    else if (price.kind === 'video_seconds') {
        const excessInputImages = Math.max(0, meter.inputImages - (price.includedInputImages ?? meter.inputImages))
        amount = new Prisma.Decimal(price.second ?? 0).times(meter.duration + meter.inputVideoSeconds).plus(new Prisma.Decimal(price.inputImage ?? 0).times(excessInputImages))
    } else if (price.kind === 'video_tokens') {
        const heights: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160 }
        const height = heights[meter.resolution]
        if (!height || !meter.duration) throw new Error('视频计费规格不完整')
        // Admission budget only. Final settlement requires upstream completion_tokens.
        const tokens = Math.ceil(((meter.duration + meter.inputVideoSeconds) * height * Math.ceil((height * 16) / 9) * 30) / 1024)
        amount = new Prisma.Decimal(price.output ?? 0).times(tokens).div(1_000_000)
    } else {
        const long = meter.inputTokenBudget > (price.longContextThreshold ?? 200000)
        amount = new Prisma.Decimal((long ? price.longInput : undefined) ?? price.input ?? 0)
            .times(meter.inputTokenBudget)
            .plus(
                new Prisma.Decimal(price.kind === 'image_tokens' ? Math.max(price.imageOutput ?? 0, price.output ?? 0) : ((long ? price.longOutput : undefined) ?? price.output ?? 0)).times(
                    meter.maxOutputTokens
                )
            )
            .div(1_000_000)
    }
    return amount.times(price.usdPerCurrency ?? 1).toNumber()
}

/** A cost is returned only from complete, supplier-reported counters. */
export function actualModelCostUsd(price: ModelPrice, meter: ModelRequestMeter, payload: unknown): number | null {
    validatePrice(price)
    const root = modelRecord(payload),
        output = modelRecord(root.output)
    const usage = modelRecord(root.usageMetadata ?? root.usage_metadata ?? root.usage ?? output.usage ?? modelRecord(root.data).usage)
    const normalized = extractApiTokenUsage(payload)
    let amount = new Prisma.Decimal(0)
    const add = (units: number | null, rate: number | undefined, million = false): boolean => {
        if (units === null || rate === undefined || !Number.isFinite(units) || units < 0) return false
        amount = amount.plus(new Prisma.Decimal(units).times(rate).div(million ? 1_000_000 : 1))
        return true
    }
    if (price.kind === 'images') {
        const entries = Array.isArray(root.data) ? root.data : Array.isArray(root.images) ? root.images : Array.isArray(output.results) ? output.results : []
        const choices = Array.isArray(output.choices) ? output.choices : []
        const returned =
            // Seedream's observed gateway response is { images: [httpsUrl] }
            // without token usage. Bill the delivered images, not requested n.
            entries.filter(item => (typeof item === 'string' ? /^(?:https?:\/\/|data:image\/)/i.test(item.trim()) : !!(modelRecord(item).url ?? modelRecord(item).b64_json))).length +
            choices.reduce((sum, item) => {
                const content = modelRecord(modelRecord(item).message).content
                return sum + (Array.isArray(content) ? content.filter(part => !!(modelRecord(part).image ?? modelRecord(part).image_url)).length : 0)
            }, 0)
        const images = numberAt(usage, 'image_count', 'output_image_count', 'output_images') ?? (returned || null)
        const imageTier = String(usage.output_image_type ?? '').toLowerCase()
        if (price.requireImageTier && !['qima_output_1k', 'qima_output_2k'].includes(imageTier)) return null
        const outputImageRate = imageTier === 'qima_output_2k' ? price.outputImage2k : price.outputImage
        if (!add(images, outputImageRate) || !add(numberAt(usage, 'input_image_count', 'input_images') ?? meter.inputImages, price.inputImage)) return null
    } else if (price.kind === 'video_seconds') {
        const videos = modelRecord(modelRecord(root.data).task_result).videos
        const durations = Array.isArray(videos) ? videos.map(video => numberAt(modelRecord(video), 'duration')) : []
        const reportedDuration = durations.length && durations.every(value => value !== null) ? durations.reduce<number>((sum, value) => sum + value!, 0) : null
        const seconds = numberAt(usage, 'output_video_duration', 'video_duration', 'duration') ?? numberAt(output, 'duration', 'video_duration') ?? numberAt(root, 'duration') ?? reportedDuration
        if (seconds === null || !add(seconds + (numberAt(usage, 'input_video_duration') ?? meter.inputVideoSeconds), price.second)) return null
        const inputImages = numberAt(usage, 'input_image_count', 'input_images') ?? meter.inputImages
        if (price.inputImage !== undefined && !add(Math.max(0, inputImages - (price.includedInputImages ?? inputImages)), price.inputImage)) return null
    } else if (price.kind === 'video_tokens') {
        if (!add(normalized?.outputTokens ?? null, price.output, true)) return null
    } else {
        const input = normalized?.inputTokens ?? null
        let outputTokens = normalized?.outputTokens ?? null
        if (input === null || outputTokens === null) return null
        const cached = numberAt(usage, 'cachedContentTokenCount', 'prompt_tokens_details.cached_tokens', 'input_tokens_details.cached_tokens', 'cache_read_input_tokens') ?? 0
        // Gemini candidatesTokenCount excludes thoughts; OpenAI completion_tokens includes them.
        if ('candidatesTokenCount' in usage) outputTokens = (numberAt(usage, 'candidatesTokenCount') ?? 0) + (numberAt(usage, 'thoughtsTokenCount') ?? 0)
        const long = input > (price.longContextThreshold ?? 200000)
        const inputRate = (long ? price.longInput : undefined) ?? price.input
        const outputRate = (long ? price.longOutput : undefined) ?? price.output
        const cachedRate = (long ? price.longCachedInput : undefined) ?? price.cachedInput
        if (cached > input || (cached > 0 && cachedRate === undefined)) return null
        if ((numberAt(usage, 'cache_creation_input_tokens', 'cache_write_tokens') ?? 0) > 0) return null
        if (!add(input - cached, inputRate, true) || (cached > 0 && !add(cached, cachedRate, true))) return null
        if (price.kind === 'image_tokens') {
            const details = usage.candidatesTokensDetails ?? usage.output_tokens_details
            const imageTokens = Array.isArray(details)
                ? details.reduce((sum, item) => (String(modelRecord(item).modality).toUpperCase() === 'IMAGE' ? sum + (numberAt(modelRecord(item), 'tokenCount', 'token_count') ?? 0) : sum), 0)
                : numberAt(usage, 'completion_tokens_details.image_tokens', 'output_tokens_details.image_tokens', 'output_image_tokens')
            if (imageTokens === null || imageTokens === undefined || imageTokens > outputTokens || imageTokens <= 0) return null
            if (!add(imageTokens, price.imageOutput, true) || !add(outputTokens - imageTokens, price.output, true)) return null
        } else if (!add(outputTokens, outputRate, true)) return null
    }
    return amount
        .times(price.usdPerCurrency ?? 1)
        .toDecimalPlaces(12)
        .toNumber()
}
