import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import os from 'node:os'
import { generateImageUnified, IMAGE_GENERATION_MAX_CONCURRENCY } from '@/services/ai'
import { publishStylePreview } from '@/services/style-preview-publishing'
import { apiResponse } from '@/lib/utils'
import { VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { requireAdminPermission } from '@/lib/admin-permissions'
import { STYLE_PREVIEW_ASSET_VERSION, STYLE_PREVIEW_PRESET_VERSION } from '@/lib/style-preview'
import { NANO_BANANA_IMAGE_MODEL } from '@/lib/gemini-models'
import { runWithConcurrency } from '@/lib/bounded-concurrency'
import { buildVisualStylePreviewPrompt } from '@/lib/visual-style-profile'

const NEW_STYLES = [
    'vampire-gothic',
    'werewolf-alpha',
    'american-highschool',
    'hollywood-blockbuster',
    'afrofuturism',
    'nollywood-glam',
    'african-tribal-fantasy',
    'hiphop-street',
    'arabian-nights',
    'middle-east-modern',
    'desert-tribal',
    'bollywood',
    'indian-mythology',
    'telenovela',
    'latin-carnival',
    'thai-supernatural',
    'southeast-asia-street',
    'european-royal',
    'nordic-noir',
    'french-romance',
    'british-period',
    'aussie-outback'
]

export async function POST(req: NextRequest) {
    // 只允许本地开发或通过授权的admin调用
    const auth = await requireAdminPermission(req, 'generate_style_previews')
    if (auth.response) return auth.response

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-style-previews-'))

    const results: Array<{
        style: string
        status: 'success' | 'error'
        message?: string
        presetVersion?: string
        finalPreviewPrompt?: string
        model?: string
        provider?: string
    }> = []

    await runWithConcurrency(NEW_STYLES, IMAGE_GENERATION_MAX_CONCURRENCY, async styleKey => {
        try {
            const style = VISUAL_STYLE_PRESETS.find(s => s.key === styleKey)
            if (!style) {
                results.push({ style: styleKey, status: 'error', message: 'Style not found' })
                return
            }

            const tmpFile = path.join(tmpDir, `${styleKey}.png`)
            const finalPreviewPrompt = buildVisualStylePreviewPrompt(style)

            console.log(`[preview] Generating ${styleKey}...`)
            const generation = await generateImageUnified({
                prompt: finalPreviewPrompt,
                outputAbsPath: tmpFile,
                aspectRatio: '3:4',
                quality: 'ultra',
                contentLabel: `风格预览“${style.label}”`
            })

            const saved = await publishStylePreview({ key: styleKey, version: STYLE_PREVIEW_ASSET_VERSION, directory: 'standard' }, await fs.readFile(tmpFile), 'image/png')
            const localUrl = saved.original.url

            console.log(`[preview] Saved locally: ${styleKey} → ${localUrl}`)
            results.push({
                style: styleKey,
                status: 'success',
                message: localUrl,
                presetVersion: STYLE_PREVIEW_PRESET_VERSION,
                finalPreviewPrompt,
                model: generation.actualProvider === 'banana' ? (process.env.NANO_BANANA_MODEL ?? NANO_BANANA_IMAGE_MODEL) : generation.actualProvider,
                provider: generation.actualProvider
            })

            // 清理临时文件
            await fs.unlink(tmpFile).catch(() => {})
        } catch (err) {
            console.error(`[preview] Failed for ${styleKey}:`, err)
            results.push({
                style: styleKey,
                status: 'error',
                message: err instanceof Error ? err.message : String(err)
            })
        }
    })

    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    return apiResponse({
        message: `Generated previews for ${NEW_STYLES.length} new styles`,
        results,
        successCount: results.filter(r => r.status === 'success').length,
        failureCount: results.filter(r => r.status === 'error').length
    })
}
