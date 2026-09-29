import { describe, expect, it } from 'vitest'
import { getProjectProductionProgress, hasMergedEpisodeVideo } from './project-progress'

const merged = (count: number) => Array.from({ length: count }, (_, index) => ({ status: 'completed', videoUrl: `https://media.example.com/episode-${index + 1}.mp4` }))

describe('project production progress', () => {
    it('completes a historical project when all 12 episodes have merged videos', () => {
        expect(getProjectProductionProgress({ status: 'in_production', totalEpisodes: 12, episodes: merged(12) })).toEqual({ status: 'completed', completedEpisodes: 12, expectedEpisodes: 12 })
    })
    it('does not confuse pre-created episode rows with completed videos', () => {
        expect(getProjectProductionProgress({ status: 'draft', totalEpisodes: 12, episodes: Array.from({ length: 12 }, () => ({ status: 'draft', videoUrl: null })) })).toEqual({
            status: 'draft',
            completedEpisodes: 0,
            expectedEpisodes: 12
        })
    })
    it('requires all planned episodes, even if every existing row is complete', () => {
        expect(getProjectProductionProgress({ status: 'in_production', totalEpisodes: 12, episodes: merged(11) })).toEqual({ status: 'in_production', completedEpisodes: 11, expectedEpisodes: 12 })
    })
    it('reopens completed projects after invalidating a merge', () => {
        expect(getProjectProductionProgress({ status: 'completed', totalEpisodes: 12, episodes: [...merged(11), { status: 'storyboarded', videoUrl: null }] })).toEqual({
            status: 'in_production',
            completedEpisodes: 11,
            expectedEpisodes: 12
        })
    })
    it('does not trust a completed episode status without a deliverable', () => {
        expect(getProjectProductionProgress({ status: 'completed', totalEpisodes: 1, episodes: [{ status: 'completed', videoUrl: '/storage/old.mp4' }] })).toEqual({
            status: 'in_production',
            completedEpisodes: 0,
            expectedEpisodes: 1
        })
    })
    it('does not ignore unfinished episodes beyond an old saved project count', () => {
        expect(getProjectProductionProgress({ status: 'completed', totalEpisodes: 1, episodes: [...merged(1), { status: 'draft' }] })).toEqual({
            status: 'in_production',
            completedEpisodes: 1,
            expectedEpisodes: 2
        })
    })
    it('never completes an empty project', () => {
        expect(getProjectProductionProgress({ status: 'draft', totalEpisodes: 0, episodes: [] })).toEqual({ status: 'draft', completedEpisodes: 0, expectedEpisodes: 0 })
    })
    it('recognizes a valid output despite a stale episode status', () => {
        expect(getProjectProductionProgress({ totalEpisodes: 1, episodes: [{ status: 'generating', videoUrl: 'https://media.example.com/1.mp4' }] }).status).toBe('completed')
    })
    it.each([null, undefined, '', '   ', '/storage/old.mp4', ' /storage/old.mp4', 'file:///tmp/1.mp4', 'not-a-url', 'javascript:alert(1)'])('rejects non-deliverable URLs: %s', url => {
        expect(hasMergedEpisodeVideo(url)).toBe(false)
    })
})
