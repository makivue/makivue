export const MAX_SELECTED_SCENE_REFERENCES = 4

export type SceneReferenceSelection = {
    version: 1
    selectedUrls: string[]
}

function uniqueReferenceUrls(values: unknown[]): string[] {
    const urls: string[] = []
    for (const value of values) {
        if (typeof value !== 'string') continue
        const url = value.trim()
        if (!url || urls.includes(url)) continue
        urls.push(url)
        if (urls.length >= MAX_SELECTED_SCENE_REFERENCES) break
    }
    return urls
}

function parseJsonValue(value: unknown): unknown {
    if (typeof value !== 'string') return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

export function getSelectedSceneReferenceUrls(referenceAssets: unknown, legacyReferenceImageUrl?: string | null): string[] {
    const parsed = parseJsonValue(referenceAssets)

    if (Array.isArray(parsed)) {
        const urls = uniqueReferenceUrls(
            parsed.map(asset => {
                if (typeof asset === 'string') return asset
                if (!asset || typeof asset !== 'object') return null
                const value = asset as { selected?: unknown; status?: unknown; url?: unknown }
                return value.selected === true || value.status === 'selected' ? value.url : null
            })
        )
        if (urls.length > 0) return urls
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const payload = parsed as { selectedUrls?: unknown }
        if (Array.isArray(payload.selectedUrls)) return uniqueReferenceUrls(payload.selectedUrls)
    }

    return uniqueReferenceUrls([legacyReferenceImageUrl])
}

export function createSceneReferenceSelection(urls: string[]): SceneReferenceSelection {
    return {
        version: 1,
        selectedUrls: uniqueReferenceUrls(urls)
    }
}
