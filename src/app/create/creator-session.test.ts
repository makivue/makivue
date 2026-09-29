import { describe, expect, it } from 'vitest'
import { createCreatorSessions, removeCreatorAssets, updateCreatorSession, type CreatorAsset } from './creator-session'

describe('independent image and video creation sessions', () => {
    it('keeps image drafts and pending work out of the video page', () => {
        let sessions = createCreatorSessions()
        const untouchedVideo = sessions.video
        sessions = updateCreatorSession(sessions, 'image', 'prompt', 'A glowing clover')
        sessions = updateCreatorSession(sessions, 'image', 'ratios', ['1:1', '3:4'])
        sessions = updateCreatorSession(sessions, 'image', 'loading', true)
        sessions = updateCreatorSession(sessions, 'image', 'generationProgress', { done: 0, total: 2 })

        expect(sessions.video).toBe(untouchedVideo)
        expect(sessions.video.loading).toBe(false)
        expect(sessions.video.prompt).toBe('')
        expect(sessions.video.ratios).toEqual(['16:9'])
        expect(sessions.image.prompt).toBe('A glowing clover')
    })

    it('routes late image completion to its original session while video is running', async () => {
        let sessions = createCreatorSessions()
        sessions = updateCreatorSession(sessions, 'image', 'loading', true)
        sessions = updateCreatorSession(sessions, 'image', 'generationProgress', { done: 0, total: 2 })
        let finishImage!: () => void
        const imageRequest = new Promise<void>(resolve => {
            finishImage = resolve
        }).then(() => {
            sessions = updateCreatorSession(sessions, 'image', 'resultUrl', '/image-result.png')
            sessions = updateCreatorSession(sessions, 'image', 'generationProgress', progress => ({ ...progress, done: progress.done + 1 }))
            sessions = updateCreatorSession(sessions, 'image', 'loading', false)
        })
        sessions = updateCreatorSession(sessions, 'video', 'prompt', 'Slow camera movement')
        sessions = updateCreatorSession(sessions, 'video', 'loading', true)
        const pendingVideo = sessions.video
        finishImage()
        await imageRequest

        expect(sessions.video).toBe(pendingVideo)
        expect(sessions.video.loading).toBe(true)
        expect(sessions.video.resultUrl).toBeNull()
        expect(sessions.image.resultUrl).toBe('/image-result.png')
        expect(sessions.image.generationProgress).toEqual({ done: 1, total: 2 })
        expect(sessions.image.loading).toBe(false)
    })

    it('keeps failures and reference uploads scoped to their page', () => {
        let sessions = createCreatorSessions()
        sessions = updateCreatorSession(sessions, 'video', 'uploadingReferenceVideos', true)
        sessions = updateCreatorSession(sessions, 'image', 'error', 'Image generation failed')
        expect(sessions.image.uploadingReferenceVideos).toBe(false)
        expect(sessions.video.error).toBeNull()
    })
})

describe('removing creator assets', () => {
    const asset = (id: string): CreatorAsset => ({ id, type: 'image', url: `/${id}.png`, coverUrl: null, prompt: id, provider: null, ratio: '1:1', duration: null, createdAt: '2026-09-20' })

    it('removes only confirmed deletions from both galleries and keeps failed items selected for retry', () => {
        const deleted = asset('deleted')
        const failed = asset('failed')
        let sessions = createCreatorSessions()
        for (const mode of ['image', 'video'] as const) {
            sessions = updateCreatorSession(sessions, mode, 'assets', [deleted, failed])
            sessions = updateCreatorSession(sessions, mode, 'selectedAssetIds', [deleted.id, failed.id])
            sessions = updateCreatorSession(sessions, mode, 'referenceAsset', deleted)
        }

        const updated = removeCreatorAssets(sessions, [deleted.id])
        for (const mode of ['image', 'video'] as const) {
            expect(updated[mode].assets).toEqual([failed])
            expect(updated[mode].selectedAssetIds).toEqual([failed.id])
            expect(updated[mode].referenceAsset).toBeNull()
            expect(sessions[mode].assets).toEqual([deleted, failed])
        }
    })

    it('preserves a new generation completed while deletion was pending and advances the deleted preview', () => {
        const deleted = asset('deleted')
        const recent = asset('recent')
        let sessions = createCreatorSessions()
        sessions = updateCreatorSession(sessions, 'image', 'resultAsset', deleted)
        sessions = updateCreatorSession(sessions, 'image', 'resultUrl', deleted.url)
        sessions = updateCreatorSession(sessions, 'image', 'resultAssets', [recent, deleted])
        sessions = updateCreatorSession(sessions, 'image', 'referenceAsset', recent)

        const updated = removeCreatorAssets(sessions, [deleted.id])
        expect(updated.image.resultAssets).toEqual([recent])
        expect(updated.image.resultAsset).toBe(recent)
        expect(updated.image.resultUrl).toBe(recent.url)
        expect(updated.image.referenceAsset).toBe(recent)

        const empty = removeCreatorAssets(updated, [recent.id])
        expect(empty.image.resultAssets).toEqual([])
        expect(empty.image.resultAsset).toBeNull()
        expect(empty.image.resultUrl).toBeNull()
    })
})
