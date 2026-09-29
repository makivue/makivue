import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { genId } from '@/lib/id'
import { requireAdminPermission } from '@/lib/admin-permissions'
import { currentUserId } from '@/lib/current-user'
import { isVideoLanguage } from '@/lib/video-language'
import { isAvailableProductionVideoProvider, isProductionImageProvider } from '@/lib/provider-capabilities'
import { normalizeImageQuality } from '@/lib/image-quality'
import { isAvailableTextModel } from '@/lib/text-model-options'
import { normalizeTextModel } from '@/services/llm'

const TEXT_MODEL_PROVIDERS = new Set(['openai', 'chapter_model', 'script_model'])
const USER_MODEL_PREFERENCE_PROVIDERS = new Set([...TEXT_MODEL_PROVIDERS, 'image', 'image_quality', 'video', 'video_language'])
const ADMIN_SETTINGS_PROVIDERS = new Set(['safety_diagnostics'])
const SUPPORTED_SETTINGS_PROVIDERS = new Set([...USER_MODEL_PREFERENCE_PROVIDERS, ...ADMIN_SETTINGS_PROVIDERS])

function isOptionalText(value: unknown): value is string | null | undefined {
    return value === undefined || value === null || typeof value === 'string'
}

async function querySettings() {
    try {
        return await prisma.aiServiceConfig.findMany({ where: { provider: { in: [...SUPPORTED_SETTINGS_PROVIDERS] } }, select: { provider: true, modelName: true } })
    } catch {
        // 数据库连接偶发 reset 时快速重试一次，避免把瞬时故障直接暴露给页面。
        await new Promise(resolve => setTimeout(resolve, 120))
        return prisma.aiServiceConfig.findMany({ where: { provider: { in: [...SUPPORTED_SETTINGS_PROVIDERS] } }, select: { provider: true, modelName: true } })
    }
}

export async function GET(req: NextRequest) {
    if (currentUserId(req) === null) return apiError('登录状态已失效，请重新登录', 401)
    let configs
    try {
        configs = await querySettings()
    } catch (error) {
        console.error('[settings] database temporarily unavailable:', error)
        return apiError('生成设置加载失败，请稍后重试', 503)
    }
    return apiResponse(
        configs
            .filter(c => SUPPORTED_SETTINGS_PROVIDERS.has(c.provider))
            .map(c => ({ provider: c.provider, modelName: TEXT_MODEL_PROVIDERS.has(c.provider) ? normalizeTextModel(c.modelName) : c.modelName }))
    )
}

export async function POST(req: NextRequest) {
    if (currentUserId(req) === null) return apiError('登录状态已失效，请重新登录', 401)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || Array.isArray(body)) return apiError('配置项无效')
    const { provider, modelName } = body
    if (typeof provider !== 'string' || !provider.trim()) return apiError('配置项无效')
    if (!SUPPORTED_SETTINGS_PROVIDERS.has(provider)) return apiError('不支持的配置项')
    // Provider secrets, endpoints and arbitrary extra settings are never accepted,
    // including from admins. This endpoint stores generation preferences only.
    if (Object.keys(body).some(key => key !== 'provider' && key !== 'modelName') || !isOptionalText(modelName)) return apiError('配置项无效')

    const normalizedModelName = TEXT_MODEL_PROVIDERS.has(provider) ? normalizeTextModel(modelName) : modelName
    if (TEXT_MODEL_PROVIDERS.has(provider) && !isAvailableTextModel(normalizedModelName)) return apiError('不支持的文本模型')
    if (provider === 'image' && !isProductionImageProvider(modelName)) return apiError('不支持的图片模型')
    if (provider === 'image_quality' && (typeof modelName !== 'string' || normalizeImageQuality(modelName) !== modelName)) return apiError('不支持的图片清晰度')
    if (provider === 'video' && !isAvailableProductionVideoProvider(modelName)) return apiError('不支持的视频模型')
    if (provider === 'video_language' && !isVideoLanguage(modelName)) return apiError('视频原声语言仅支持中文或英文')
    if (ADMIN_SETTINGS_PROVIDERS.has(provider)) {
        if (modelName !== 'enabled' && modelName !== 'disabled') return apiError('配置项无效')
        const auth = await requireAdminPermission(req, 'manage_settings')
        if (auth.response) return auth.response
    }

    const config = await prisma.aiServiceConfig.upsert({
        where: { provider },
        update: { modelName: normalizedModelName },
        create: { id: genId(), provider, modelName: normalizedModelName },
        select: { provider: true, modelName: true }
    })
    return apiResponse({ provider: config.provider, modelName: config.modelName })
}
