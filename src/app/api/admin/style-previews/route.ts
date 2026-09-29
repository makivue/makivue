import { requireAdminPermission } from '@/lib/admin-permissions'
import { apiError, apiResponse } from '@/lib/utils'
import { STYLE_PREVIEW_MAX_BYTES, STYLE_PREVIEW_THUMBNAIL_WIDTHS, StylePreviewPublishError, validateStylePreviewPublication, type StylePreviewPublication } from '@/lib/style-preview-publishing'
import { publishStylePreview } from '@/services/style-preview-publishing'

export const runtime = 'nodejs'
export const maxDuration = 180

async function authorize(req: Request) {
    const auth = await requireAdminPermission(req, 'generate_style_previews')
    if (auth.response) return auth.response
    return null
}

/** Authenticated preflight before local generation incurs provider charges. */
export async function GET(req: Request) {
    const denied = await authorize(req)
    if (denied) return denied
    return apiResponse({ environment: 'local', prefix: 'style-previews', thumbnailWidths: STYLE_PREVIEW_THUMBNAIL_WIDTHS, maxBytes: STYLE_PREVIEW_MAX_BYTES })
}

/** One raw PNG/JPEG/WebP body per request; new keys are saved under public/style-previews. */
export async function POST(req: Request) {
    const denied = await authorize(req)
    if (denied) return denied
    try {
        const params = new URL(req.url).searchParams
        const input = { key: params.get('key') ?? '', version: params.get('version') ?? '', directory: params.get('directory') ?? 'standard' } as StylePreviewPublication
        validateStylePreviewPublication(input)
        const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) return apiError('Send a raw PNG, JPEG or WebP image body', 415)
        if (Number(req.headers.get('content-length')) > STYLE_PREVIEW_MAX_BYTES) return apiError('Image exceeds 32 MiB', 413)
        if (!req.body) return apiError('Image body is required', 400)
        const reader = req.body.getReader()
        const chunks: Uint8Array[] = []
        let total = 0
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                total += value.byteLength
                if (total > STYLE_PREVIEW_MAX_BYTES) {
                    await reader.cancel()
                    return apiError('Image exceeds 32 MiB', 413)
                }
                chunks.push(value)
            }
        } finally {
            reader.releaseLock()
        }
        if (!total) return apiError('Image body is required', 400)
        return apiResponse(await publishStylePreview(input, Buffer.concat(chunks, total), contentType))
    } catch (error) {
        if (error instanceof StylePreviewPublishError) return apiError(error.message, error.status)
        console.error('[style-preview-publish] failed', { code: (error as { code?: string }).code ?? 'unknown' })
        return apiError('Local style preview save failed; retry the same image', 502)
    }
}
