import { stripLocale } from '@/i18n/config'
import { isValidRouteResourceId } from './home-redirect'

export function episodeWorkspaceRoute(pathname: string): { projectId: string; episodeId: string } | null {
    const match = /^\/projects\/([^/]+)\/episodes\/([^/]+)$/.exec(stripLocale(pathname))
    if (!match || !isValidRouteResourceId(match[1]) || !isValidRouteResourceId(match[2])) return null
    return { projectId: match[1], episodeId: match[2] }
}

export function neighbouringEpisodeIds(episodes: readonly { id: string }[], episodeId: string): string[] {
    const index = episodes.findIndex(episode => episode.id === episodeId)
    if (index < 0) return []
    return [episodes[index + 1]?.id, episodes[index - 1]?.id].filter((id): id is string => Boolean(id))
}
