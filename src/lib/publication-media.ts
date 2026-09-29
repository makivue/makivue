import { parseNovelSetup } from '@/lib/novel'

const PUBLICATION_MEDIA_CANDIDATE_LIMIT = 24

export type PublicationCoverCandidate = {
    url: string
    label: string
    source: 'current' | 'generated' | 'style' | 'storyboard' | 'scene' | 'character'
}

export type PublicationTrailerCandidate = {
    url: string
    label: string
    source: 'current' | 'episode'
    episodeId?: string
    episodeNumber?: number
}

type PublicationMediaProject = {
    coverUrl?: string | null
    trailerUrl?: string | null
    publicationCoverCandidates?: unknown
    publicationTrailerCandidates?: unknown
    novelSetup?: string | null
    characters?: Array<{ name: string; referenceImageUrl: string | null }>
    scenes?: Array<{ name: string; referenceImageUrl: string | null }>
    episodes?: Array<{
        id?: bigint | string
        episodeNumber?: number
        title?: string | null
        videoUrl?: string | null
        storyboards?: Array<{ order?: number; firstFrameUrl?: string | null; lastFrameUrl?: string | null }>
    }>
}

function mediaUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    if (!normalized || normalized.length > 1024 || (!/^https?:\/\//i.test(normalized) && !normalized.startsWith('/'))) return null
    return normalized
}

export function normalizePublicationMediaUrls(value: unknown, limit = PUBLICATION_MEDIA_CANDIDATE_LIMIT): string[] {
    let values = value
    if (typeof value === 'string') {
        try {
            values = JSON.parse(value)
        } catch {
            values = [value]
        }
    }
    if (!Array.isArray(values)) return []
    const result: string[] = []
    for (const item of values) {
        const url = mediaUrl(item)
        if (url && !result.includes(url)) result.push(url)
        if (result.length >= limit) break
    }
    return result
}

export function publicationCoverCandidates(project: PublicationMediaProject): PublicationCoverCandidate[] {
    const candidates: PublicationCoverCandidate[] = []
    const seen = new Set<string>()
    const add = (value: unknown, label: string, source: PublicationCoverCandidate['source']) => {
        const url = mediaUrl(value)
        if (!url || seen.has(url) || candidates.length >= PUBLICATION_MEDIA_CANDIDATE_LIMIT) return
        seen.add(url)
        candidates.push({ url, label, source })
    }

    add(project.coverUrl, '当前封面', 'current')
    normalizePublicationMediaUrls(project.publicationCoverCandidates).forEach((url, index) => add(url, `封面候选 ${index + 1}`, 'generated'))
    parseNovelSetup(project.novelSetup).styleReferenceImages?.forEach((url, index) => add(url, `视觉风格图 ${index + 1}`, 'style'))
    project.episodes?.forEach(episode =>
        episode.storyboards?.forEach(storyboard => {
            const episodeLabel = `第 ${episode.episodeNumber ?? '-'} 集${episode.title ? ` · ${episode.title}` : ''}`
            add(storyboard.firstFrameUrl, `${episodeLabel} · 镜头 ${storyboard.order ?? '-'} 首帧`, 'storyboard')
            add(storyboard.lastFrameUrl, `${episodeLabel} · 镜头 ${storyboard.order ?? '-'} 尾帧`, 'storyboard')
        })
    )
    project.scenes?.forEach(scene => add(scene.referenceImageUrl, `场景 · ${scene.name}`, 'scene'))
    project.characters?.forEach(character => add(character.referenceImageUrl, `角色 · ${character.name}`, 'character'))
    return candidates
}

export function publicationTrailerCandidates(project: PublicationMediaProject): PublicationTrailerCandidate[] {
    const candidates: PublicationTrailerCandidate[] = []
    const seen = new Set<string>()
    const add = (value: unknown, candidate: Omit<PublicationTrailerCandidate, 'url'>) => {
        const url = mediaUrl(value)
        if (!url || seen.has(url) || candidates.length >= PUBLICATION_MEDIA_CANDIDATE_LIMIT) return
        seen.add(url)
        candidates.push({ url, ...candidate })
    }

    project.episodes?.forEach(episode => {
        const episodeId = episode.id?.toString()
        add(episode.videoUrl, {
            label: `第 ${episode.episodeNumber ?? '-'} 集${episode.title ? ` · ${episode.title}` : ''}`,
            source: 'episode',
            ...(episodeId ? { episodeId } : {}),
            ...(episode.episodeNumber ? { episodeNumber: episode.episodeNumber } : {})
        })
    })
    add(project.trailerUrl, { label: '当前上传的预告片', source: 'current' })
    normalizePublicationMediaUrls(project.publicationTrailerCandidates).forEach((url, index) => add(url, { label: `自定义预告片 ${index + 1}`, source: 'current' }))
    return candidates
}
