import { NextRequest } from 'next/server'
import { apiError, apiResponse } from '@/lib/utils'
import { getVisualStyle, getVisualStylePreviewSrc, VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { currentUserId } from '@/lib/current-user'
import { STYLE_PREVIEW_PRESET_VERSION } from '@/lib/style-preview'
import { buildVisualStylePreviewPrompt, createVisualStyleProfile } from '@/lib/visual-style-profile'

export async function GET(req: NextRequest) {
    if (currentUserId(req) === null) return apiError('登录状态已失效，请重新登录', 401)
    return apiResponse(
        VISUAL_STYLE_PRESETS.map(style => {
            const visualStyleProfile = createVisualStyleProfile(style)
            const finalPreviewPrompt = buildVisualStylePreviewPrompt(style, visualStyleProfile)
            return {
                key: style.key,
                label: style.label,
                hint: style.hint,
                previewPrompt: finalPreviewPrompt,
                finalPreviewPrompt,
                visualStyleProfile,
                presetVersion: STYLE_PREVIEW_PRESET_VERSION,
                model: 'static-preview-manifest',
                previewSrc: getVisualStylePreviewSrc(style)
            }
        })
    )
}

export async function POST(req: NextRequest) {
    if (currentUserId(req) === null) return apiError('登录状态已失效，请重新登录', 401)
    const { key } = await req.json()
    if (!key) return apiError('key required')
    const style = getVisualStyle(key)
    const visualStyleProfile = createVisualStyleProfile(style)
    const finalPreviewPrompt = buildVisualStylePreviewPrompt(style, visualStyleProfile)
    return apiResponse({
        key: style.key,
        label: style.label,
        previewPrompt: finalPreviewPrompt,
        finalPreviewPrompt,
        visualStyleProfile,
        presetVersion: STYLE_PREVIEW_PRESET_VERSION,
        model: 'static-preview-manifest',
        recommendedFilename: `${style.key}.png`,
        recommendedOSSPath: `style-previews/${style.key}.png`
    })
}
