import { VISUAL_STYLE_PRESETS } from '../src/lib/novel'
import { getRegionalStoryPreset } from '../src/lib/regional-story-presets'
import { STYLE_PREVIEW_ASSET_VERSION, STYLE_PREVIEW_PRESET_VERSION, getStylePreviewSrc } from '../src/lib/style-preview'
import { buildVisualStylePreviewPrompt, createVisualStyleProfile } from '../src/lib/visual-style-profile'

export { STYLE_PREVIEW_ASSET_VERSION }

/** Read presets and bundled image paths directly from the local source tree. */
export function localStylePreviewCatalog() {
    return VISUAL_STYLE_PRESETS.map(style => ({
        key: style.key,
        label: style.label,
        directory: getRegionalStoryPreset(style.key) ? 'regional-generated' : 'standard',
        previewPrompt: buildVisualStylePreviewPrompt(style, createVisualStyleProfile(style)),
        presetVersion: STYLE_PREVIEW_PRESET_VERSION,
        previewSrc: getStylePreviewSrc(style.key)
    }))
}
