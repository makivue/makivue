export const DRAMA_UPLOAD_SOURCE = 'drama-upload'

export type UploadedDramaSource = {
    source?: unknown
    year?: unknown
    cast?: unknown
    subtitleLanguage?: unknown
}

export function isUploadedDrama(value: unknown): value is UploadedDramaSource {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { source?: unknown }).source === DRAMA_UPLOAD_SOURCE)
}

export type UploadedDramaCastMember = { name: string; role: string; job: string; imageUrl: string | null }

export function uploadedDramaSource(value: unknown): UploadedDramaSource {
    return isUploadedDrama(value) ? value : {}
}

export function uploadedDramaCast(value: unknown): UploadedDramaCastMember[] {
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const person = item as Record<string, unknown>
        return [
            {
                name: typeof person.name === 'string' ? person.name : '',
                role: typeof person.role === 'string' ? person.role : '',
                job: typeof person.job === 'string' ? person.job : '',
                imageUrl: typeof person.imageUrl === 'string' ? person.imageUrl : null
            }
        ]
    })
}
