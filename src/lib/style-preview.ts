import { getRegionalStoryPreset } from './regional-story-presets'

export const STYLE_PREVIEW_PRESET_VERSION = 'style-preview-v2@2026-08-25'
export const STYLE_PREVIEW_ASSET_VERSION = 'v-example'

// Both app environments use an independently published, immutable OSS release.
// The optional thumbnail widths are published for the homepage poster styles.
export function getStylePreviewSrc(styleKey: string, thumbnailWidth?: 256 | 384): string {
    const configuredBaseUrl = process.env.NEXT_PUBLIC_STYLE_PREVIEW_BASE_URL?.trim()
    const baseUrl = configuredBaseUrl || 'https://assets.example.invalid/aigc-assets/style-previews'
    const directory = getRegionalStoryPreset(styleKey) ? 'regional-generated/' : ''
    const thumbnailDirectory = thumbnailWidth ? `thumbs/${thumbnailWidth}/` : ''

    return `${baseUrl.replace(/\/$/, '')}/${STYLE_PREVIEW_ASSET_VERSION}/${thumbnailDirectory}${directory}${encodeURIComponent(styleKey)}.webp`
}
