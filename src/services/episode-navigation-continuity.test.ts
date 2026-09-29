import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode navigation continuity', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('reuses the previous workspace while the next dynamic episode route loads', () => {
        expect(page).toContain('const episodeWorkspaceCache = new Map<string, EpisodeWorkspaceCache>()')
        expect(page).toContain('cached.episodes.get(episodeId) ?? cached.lastEpisode')
        expect(page).toContain('progressNavScrollTop: progressNavScrollTopRef.current')
    })

    it('preserves both sidebar expansion choices across episode switches', () => {
        expect(page).toContain('globalNavCollapsed: cached.globalNavCollapsed')
        expect(page).toContain('progressNavCollapsed: cached.progressNavCollapsed')
        expect(page).toContain('useState(() => cachedWorkspace?.globalNavCollapsed ?? true)')
        expect(page).toContain('useState(() => cachedWorkspace?.progressNavCollapsed ?? true)')
    })

    it('keeps publication available from the episode workspace sidebar', () => {
        expect(page).toContain('href={`/projects/${projectId}/publication`}')
        expect(page).toContain("title={t('发布作品')}")
    })

    it('restores the internal episode-list scroll position instead of jumping to the top', () => {
        expect(page).toContain('const progressNavScrollTopRef = useRef(cachedWorkspace?.progressNavScrollTop ?? 0)')
        expect(page).toContain('if (node) node.scrollTop = progressNavScrollTopRef.current')
        expect(page).toContain('progressNavScrollTopRef.current = event.currentTarget.scrollTop')
        expect(page).toContain('if (cached) cached.progressNavScrollTop = event.currentTarget.scrollTop')
    })

    it('reuses the shell but validates cached content before displaying media', () => {
        expect(page).toContain('aria-busy={isEpisodeChanging}')
        expect(page).toContain('className="absolute inset-0 z-30 cursor-wait"')
        expect(page).toContain('verifiedEpisodeId !== episodeId')
        expect(page).toContain('{!isEpisodeChanging &&')
        expect(page).not.toContain('bg-gray-950/70 backdrop-blur-sm')
        expect(page).toContain("window.history.pushState(null, '', localizePath(`/projects/${projectId}/episodes/${epId}`, locale))")
        expect(page).toContain('episodeWorkspaceRoute(pathname)')
        expect(page).toContain('key={`${route.projectId}:${route.episodeId}`}')
    })
})
