import sharp from 'sharp'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { STYLE_PREVIEW_MAX_BYTES, STYLE_PREVIEW_THUMBNAIL_WIDTHS, StylePreviewPublishError, validateStylePreviewPublication, type StylePreviewPublication } from './style-preview-publishing'

export async function publishBundledStylePreview(input: StylePreviewPublication, source: Buffer, contentType: string, publicRoot = path.join(process.cwd(), 'public')) {
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

    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    const root = path.resolve(publicRoot)
    async function writeImage(bytes: Buffer, width?: 256 | 384) {
        const relative = `style-previews/${width ? `thumbs/${width}/` : ''}${input.key}.webp`
        const target = path.join(root, relative)
        // Refuse symlinks instead of writing outside the bundled assets directory.
        let current = root
        for (const part of ['', ...relative.split('/')]) {
            if (part) current = path.join(current, part)
            const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') throw error
                return null
            })
            if (stat?.isSymbolicLink()) throw new StylePreviewPublishError('Style preview symlinks are not allowed', 400)
        }
        await fs.mkdir(path.dirname(target), { recursive: true })
        const temporary = path.join(path.dirname(target), `.preview-${randomUUID()}.tmp`)
        try {
            await fs.writeFile(temporary, bytes)
            await fs.rename(temporary, target)
        } finally {
            await fs.rm(temporary, { force: true })
        }
        return { url: `/${relative}`, bytes: bytes.length, sourceSha256 }
    }
    const publishedOriginal = await writeImage(original)
    const publishedThumbnails = []
    for (const [index, width] of STYLE_PREVIEW_THUMBNAIL_WIDTHS.entries()) {
        publishedThumbnails.push({ width, ...(await writeImage(thumbnails[index], width)) })
    }
    return { ...input, original: publishedOriginal, thumbnails: publishedThumbnails }
}
