import 'server-only'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { createProductionStylePreviewStore } from './oss'
import { STYLE_PREVIEW_MAX_BYTES, STYLE_PREVIEW_THUMBNAIL_WIDTHS, StylePreviewPublishError, validateStylePreviewPublication, type StylePreviewPublication } from '@/lib/style-preview-publishing'

export async function publishStylePreview(input: StylePreviewPublication, source: Buffer, contentType: string) {
    validateStylePreviewPublication(input)
    if (!source.length || source.length > STYLE_PREVIEW_MAX_BYTES) throw new StylePreviewPublishError('Image must be between 1 byte and 32 MiB', 413)
    const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }
    if (!formats[contentType]) throw new StylePreviewPublishError('Only PNG, JPEG and WebP are supported', 415)

    let original: Buffer
    let thumbnails: Buffer[]
    try {
        const image = sharp(source, { limitInputPixels: 40_000_000, failOn: 'warning' })
        const metadata = await image.metadata()
        if (metadata.format !== formats[contentType] || (metadata.pages ?? 1) !== 1) throw new Error('Invalid format or animated image')
        // Decode even existing WebP input to reject corrupt payloads; retain original WebP bytes.
        const encoded = await image.clone().rotate().webp({ quality: 85 }).toBuffer()
        original = metadata.format === 'webp' && !metadata.orientation ? source : encoded
        thumbnails = await Promise.all(STYLE_PREVIEW_THUMBNAIL_WIDTHS.map(width => image.clone().rotate().resize({ width }).webp({ quality: 65 }).toBuffer()))
    } catch {
        throw new StylePreviewPublishError('Invalid image, animation, or image exceeds 40 megapixels', 422)
    }

    const store = await createProductionStylePreviewStore()
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    // Original establishes the immutable source before any derived objects are written.
    const publishedOriginal = await store.put(input, original, sourceSha256)
    const publishedThumbnails = []
    for (const [index, width] of STYLE_PREVIEW_THUMBNAIL_WIDTHS.entries()) {
        publishedThumbnails.push({ width, ...(await store.put(input, thumbnails[index], sourceSha256, width)) })
    }
    return { ...input, original: publishedOriginal, thumbnails: publishedThumbnails }
}
