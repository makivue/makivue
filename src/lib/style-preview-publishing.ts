export const STYLE_PREVIEW_OBJECT_PREFIX = 'studio-assets/style-previews'
export const STYLE_PREVIEW_MAX_BYTES = 32 * 1024 * 1024
export const STYLE_PREVIEW_THUMBNAIL_WIDTHS = [256, 384] as const

export type StylePreviewPublication = {
    key: string
    version: string
    directory: 'standard' | 'regional-generated'
}

export class StylePreviewPublishError extends Error {
    constructor(
        message: string,
        public readonly status: number
    ) {
        super(message)
    }
}

export function validateStylePreviewPublication(input: StylePreviewPublication) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.key) || input.key.length > 100) throw new StylePreviewPublishError('Invalid style key', 400)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.version)) throw new StylePreviewPublishError('Invalid asset version', 400)
    if (input.directory !== 'standard' && input.directory !== 'regional-generated') throw new StylePreviewPublishError('Invalid style directory', 400)
}

export function stylePreviewObjectKey(input: StylePreviewPublication, width?: 256 | 384) {
    validateStylePreviewPublication(input)
    return `${STYLE_PREVIEW_OBJECT_PREFIX}/${input.version}/${width ? `thumbs/${width}/` : ''}${input.directory === 'regional-generated' ? 'regional-generated/' : ''}${input.key}.webp`
}
