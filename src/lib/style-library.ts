import { getVisualStyleProfile, type NovelSetup } from './novel'

export interface StyleLibraryEntry {
    id: string
    kind: 'style' | 'theme'
    name: string
    description: string
    baseStyle: string
    region: string | null
    genre: string | null
    referenceImages: string[]
}

export function serializeStyleLibraryEntry(row: Omit<StyleLibraryEntry, 'id' | 'kind' | 'referenceImages'> & { id: bigint; kind: string; referenceImages: unknown }): StyleLibraryEntry {
    return {
        id: row.id.toString(),
        kind: row.kind === 'theme' ? 'theme' : 'style',
        name: row.name,
        description: row.description,
        baseStyle: row.baseStyle,
        region: row.region,
        genre: row.genre,
        referenceImages: Array.isArray(row.referenceImages) ? row.referenceImages.filter((url): url is string => typeof url === 'string').slice(0, 3) : []
    }
}

/** Freeze authored direction and image anchors in the project, independent of the library. */
export function styleLibrarySetup(entry: StyleLibraryEntry): Partial<NovelSetup> {
    const profile = getVisualStyleProfile(entry.baseStyle)
    const direction = [entry.name, entry.description, entry.region].filter(Boolean).join('\n')
    return {
        visualStyle: entry.baseStyle,
        styleReferencePrompt: direction,
        styleReferenceImages: entry.referenceImages,
        ...(entry.kind === 'theme' ? { worldBible: direction } : {}),
        visualStyleProfile: {
            ...profile,
            hint: `${profile.hint}; ${entry.name}`,
            artDirection: { summary: entry.name, prompt: `${profile.artDirection.prompt}; ${direction}` },
            imagePromptPrefix: `${profile.imagePromptPrefix}; User art direction: ${direction}`,
            videoPromptPrefix: `${profile.videoPromptPrefix}; User art direction: ${direction}`
        }
    }
}
