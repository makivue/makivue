export type PublicWork = {
    id: string
    title: string
    description: string | null
    seoTitle: string | null
    seoDescription: string | null
    coverUrl: string | null
    coverAlt: string | null
    trailerUrl: string | null
    genre: { code: string | null; label: string | null }
    totalEpisodes: number | null
    completedEpisodes: number
    status: string
    contentLanguage: string | null
    publishedAt: string
    author: { displayName: string | null; avatarUrl: string | null }
}

export type PublicWorkDetail = PublicWork & {
    episodes: Array<{ id: string; episodeNumber: number; title: string | null; videoUrl: string }>
}
