export const STYLE_PREVIEW_PRESET_VERSION = 'local-v1'
export const STYLE_PREVIEW_ASSET_VERSION = 'local-v2'

/** New presets keep bundled editorial previews until the local user generates artwork. */
const EDITORIAL_PREVIEW_KEYS = new Set([
    'pixel-art', 'smartphone-pov', 'found-footage', 'analog-horror', 'surreal-asmr', 'photoreal-pet-drama',
    'ancient-indian-war', 'rajput-fortress-war', 'ancient-egypt-epic', 'ancient-greek-epic', 'roman-legion-epic',
    'viking-saga', 'medieval-knights', 'ancient-persian-epic', 'three-kingdoms-epic', 'mesoamerican-epic',
    'cozy-sitcom', 'mockumentary-comedy', 'cooking-macro', 'travel-diary', 'outdoor-sports', 'stage-musical',
    'fashion-editorial', 'product-commercial', 'science-explainer', 'architecture-tour', 'retro-rubber-hose', 'modern-family-animation'
])

export function isEditorialStylePreview(styleKey: string): boolean {
    return EDITORIAL_PREVIEW_KEYS.has(styleKey)
}

/** Bundled with the source code; never use a CDN or an environment URL override. */
export function getStylePreviewSrc(styleKey: string, thumbnailWidth?: 256 | 384): string {
    return `/style-previews/${thumbnailWidth ? `thumbs/${thumbnailWidth}/` : ''}${encodeURIComponent(styleKey)}.webp`
}
