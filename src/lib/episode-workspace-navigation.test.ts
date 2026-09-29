import { describe, expect, it } from 'vitest'
import { episodeWorkspaceRoute, neighbouringEpisodeIds } from './episode-workspace-navigation'

describe('episode workspace URL navigation', () => {
    it.each(['', '/zh', '/fr', '/ar', '/ja', '/ko', '/id', '/hi', '/fil'])('resolves the current %s URL without relying on stale server route parameters', prefix => {
        expect(episodeWorkspaceRoute(`${prefix}/projects/638260232912411993/episodes/638260232946425177`)).toEqual({
            projectId: '638260232912411993',
            episodeId: '638260232946425177'
        })
    })

    it.each(['/projects/1', '/projects/1/characters', '/projects/1/episodes/2/edit', '/zh/projects/0/episodes/2', '/zh/projects/1/episodes/invalid'])(
        'does not intercept another route or invalid ID: %s',
        pathname => {
            expect(episodeWorkspaceRoute(pathname)).toBeNull()
        }
    )

    it('limits speculative loading to adjacent episodes in project order', () => {
        const episodes = [{ id: '30' }, { id: '10' }, { id: '40' }, { id: '20' }]
        expect(neighbouringEpisodeIds(episodes, '10')).toEqual(['40', '30'])
        expect(neighbouringEpisodeIds(episodes, '30')).toEqual(['10'])
        expect(neighbouringEpisodeIds(episodes, '20')).toEqual(['40'])
        expect(neighbouringEpisodeIds(episodes, 'missing')).toEqual([])
        expect(neighbouringEpisodeIds([{ id: '30' }], '30')).toEqual([])
    })
})
