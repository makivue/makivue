export const STYLE_PREVIEW_PRESET_VERSION = 'local-v1'
export const STYLE_PREVIEW_ASSET_VERSION = 'local-v2'

/** Bundled with the source code; never use a CDN or an environment URL override. */
export function getStylePreviewSrc(styleKey: string, thumbnailWidth?: 256 | 384): string {
    return `/style-previews/${thumbnailWidth ? `thumbs/${thumbnailWidth}/` : ''}${encodeURIComponent(styleKey)}.webp`
}
