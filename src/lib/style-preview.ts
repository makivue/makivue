export const STYLE_PREVIEW_PRESET_VERSION = 'local-v1'
export const STYLE_PREVIEW_ASSET_VERSION = 'local-v1'
export function getStylePreviewSrc(styleKey: string, _thumbnailWidth?: 256 | 384): string {
    void _thumbnailWidth

    return `/style-previews/${encodeURIComponent(styleKey)}.svg`
}
