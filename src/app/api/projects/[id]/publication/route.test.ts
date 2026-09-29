import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    projectFindFirst: vi.fn(),
    projectUpdate: vi.fn(),
    profileFindUnique: vi.fn(),
    identityFindUnique: vi.fn()
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/lib/prisma', () => ({
    prisma: {
        project: { findFirst: mocks.projectFindFirst, update: mocks.projectUpdate },
        userProfile: { findUnique: mocks.profileFindUnique },
        userIdentity: { findUnique: mocks.identityFindUnique }
    }
}))

import { GET, PATCH } from './route'

const completeProject = {
    id: 456n,
    userId: 123n,
    title: '雨夜追凶',
    description: '一场雨夜谜案。',
    genreCode: 'suspense',
    genreLabel: '悬疑',
    seoTitle: '雨夜追凶',
    seoDescription: '一场雨夜谜案。',
    seoKeywords: ['悬疑'],
    coverUrl: 'https://example.com/cover.jpg',
    coverAlt: '雨夜追凶封面',
    trailerUrl: 'https://example.com/trailer.mp4',
    trailerDuration: 30,
    videoAspectRatio: '9:16',
    visualStyle: 'cinematic',
    contentLanguage: 'zh',
    subtitleLanguages: ['zh', 'en'],
    episodeFormat: 'micro',
    totalEpisodes: 12,
    episodes: Array.from({ length: 12 }, () => ({ status: 'completed', videoUrl: 'https://example.com/episode.mp4' })),
    status: 'completed',
    visibility: 'private',
    publishedAt: null,
    createdAt: new Date('2026-09-17T00:00:00Z'),
    updatedAt: new Date('2026-09-17T00:00:00Z')
}

function request(body: Record<string, unknown>) {
    return new NextRequest('http://localhost:3000/api/projects/456/publication', { method: 'PATCH', body: JSON.stringify(body) })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertProjectOwner.mockResolvedValue(null)
    mocks.profileFindUnique.mockResolvedValue({ displayName: '小雨', avatarUrl: 'https://example.com/avatar.jpg' })
    mocks.identityFindUnique.mockResolvedValue(null)
})

describe('PATCH /api/projects/[id]/publication', () => {
    it.each([1, 11])('does not publish when only %i of 12 planned episodes exist and have merged videos', async count => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, episodes: completeProject.episodes.slice(0, count) })
        const response = await PATCH(request({ visibility: 'public' }), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(422)
        expect((await response.json()).error).toContain('请先生成所有集的合成视频')
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
    it.each([null, '', '   ', '/storage/episode.mp4', 'file:///tmp/episode.mp4'])('does not trust a completed status when one merged video is invalid: %s', async videoUrl => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, episodes: [...completeProject.episodes.slice(0, 11), { status: 'completed', videoUrl }] })
        const response = await PATCH(request({ visibility: 'public' }), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(422)
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
    it('includes unfinished episodes beyond the saved project count in publication progress', async () => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, episodes: [...completeProject.episodes, { status: 'draft', videoUrl: null }] })
        const response = await GET(new NextRequest('http://localhost/api/projects/456/publication'), { params: Promise.resolve({ id: '456' }) })
        expect((await response.json()).data).toMatchObject({ status: 'in_production', completedEpisodes: 12, expectedEpisodes: 13, publicationIssues: ['请先生成所有集的合成视频'] })
        const publication = await PATCH(request({ visibility: 'public' }), { params: Promise.resolve({ id: '456' }) })
        expect(publication.status).toBe(422)
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
    it('allows saving a private draft before all episodes have merged videos', async () => {
        const incompleteProject = { ...completeProject, episodes: completeProject.episodes.slice(0, 1) }
        mocks.projectFindFirst.mockResolvedValue(incompleteProject)
        mocks.projectUpdate.mockImplementation(({ data }) => Promise.resolve({ ...incompleteProject, ...data }))
        const response = await PATCH(request({ visibility: 'private', seoTitle: '新版标题' }), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(200)
        expect((await response.json()).data).toMatchObject({ visibility: 'private', seoTitle: '新版标题', completedEpisodes: 1, expectedEpisodes: 12 })
        expect(mocks.projectUpdate).toHaveBeenCalledOnce()
    })
    it('rechecks current merged videos when saving an already public work', async () => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, visibility: 'public', episodes: completeProject.episodes.slice(0, 11) })
        const response = await PATCH(request({ seoTitle: '新版标题' }), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(422)
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
    it('does not publish a work with metadata but no playable episode', async () => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, episodes: [] })
        const response = await PATCH(request({ visibility: 'public' }), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(422)
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
    it('reports production completion independently of publication', async () => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, status: 'in_production' })
        const response = await GET(new NextRequest('http://localhost/api/projects/456/publication'), { params: Promise.resolve({ id: '456' }) })
        const { data } = await response.json()
        expect(data).toMatchObject({ status: 'completed', completedEpisodes: 12, expectedEpisodes: 12, visibility: 'private', publishedAt: null })
        expect(data).not.toHaveProperty('episodes')
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
    it('blocks public publication when required metadata is incomplete', async () => {
        mocks.projectFindFirst.mockResolvedValue({ ...completeProject, coverUrl: null })

        const response = await PATCH(request({ visibility: 'public' }), { params: Promise.resolve({ id: '456' }) })
        const body = await response.json()

        expect(response.status).toBe(422)
        expect(body.error).toContain('请上传作品封面')
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })

    it('sets the first publication time when a complete work becomes public', async () => {
        mocks.projectFindFirst.mockResolvedValue(completeProject)
        mocks.projectUpdate.mockImplementation(({ data }) => Promise.resolve({ ...completeProject, ...data }))

        const response = await PATCH(request({ visibility: 'public' }), { params: Promise.resolve({ id: '456' }) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.visibility).toBe('public')
        expect(body.data.publicationIssues).toEqual([])
        expect(mocks.projectUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 456n },
                data: expect.objectContaining({ visibility: 'public', publishedAt: expect.any(Date) })
            })
        )
    })

    it('updates the normalized work genre together with editable publication copy', async () => {
        mocks.projectFindFirst.mockResolvedValue(completeProject)
        mocks.projectUpdate.mockImplementation(({ data }) => Promise.resolve({ ...completeProject, ...data }))

        const response = await PATCH(request({ genre: '科幻', seoTitle: '星海归途' }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(200)
        expect(mocks.projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ genre: '科幻', genreCode: 'sci_fi', genreLabel: '科幻', seoTitle: '星海归途' }) }))
    })

    it('rejects a work genre that cannot fit the legacy genre column', async () => {
        const response = await PATCH(request({ genre: '类'.repeat(51) }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(400)
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
})
