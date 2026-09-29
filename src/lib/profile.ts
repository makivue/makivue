export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 80
export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024

export const PROFILE_AVATAR_EXTENSIONS: Readonly<Record<string, string>> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
}

export function normalizeProfileDisplayName(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    if (!normalized || Array.from(normalized).length > PROFILE_DISPLAY_NAME_MAX_LENGTH) return null
    return normalized
}

export function normalizeProfileAvatarUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024) return null
    try {
        const url = new URL(value.trim())
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
    } catch {
        return null
    }
}
