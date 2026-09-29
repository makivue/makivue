import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    projectFindFirst: vi.fn(),
    projectUpdate: vi.fn()
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findFirst: mocks.projectFindFirst, update: mocks.projectUpdate } } }))
vi.mock('@/services/oss', () => ({
    isOSSObjectWithinSubdir: vi.fn(() => false),
    deleteOSSObjectWithinSubdir: vi.fn(),
    uploadToOSS: vi.fn()
}))
vi.mock('@/services/ffmpeg', () => ({ probeMediaStreams: vi.fn() }))

import { PUT } from './route'

const project = {
    coverUrl: null,
    trailerUrl: null,
    publicationCoverCandidates: [],
    publicationTrailerCandidates: [],
    novelSetup: null,
    characters: [],
    scenes: [{ name: '舰桥', referenceImageUrl: 'https://cdn.test/scene.png' }],
    episodes: [
        {
            id: 91n,
            episodeNumber: 1,
            title: '启航',
            videoUrl: 'https://cdn.test/episode.mp4',
            storyboards: [{ order: 1, firstFrameUrl: 'https://cdn.test/frame.png', lastFrameUrl: null }]
        }
    ]
}

function request(kind: 'cover' | 'trailer', url: string) {
    return new NextRequest('http://localhost/api/projects/7/publication-media', { method: 'PUT', body: JSON.stringify({ kind, url }) })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(3n)
    mocks.assertProjectOwner.mockResolvedValue(null)
    mocks.projectFindFirst.mockResolvedValue(project)
    mocks.projectUpdate.mockResolvedValue({})
})

describe('PUT /api/projects/[id]/publication-media', () => {
    it('selects an existing project image as the cover', async () => {
        const response = await PUT(request('cover', 'https://cdn.test/frame.png'), { params: Promise.resolve({ id: '7' }) })
        expect(response.status).toBe(200)
        expect(mocks.projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7n }, data: expect.objectContaining({ coverUrl: 'https://cdn.test/frame.png' }) }))
    })

    it('selects an existing episode as the trailer without copying the video', async () => {
        const response = await PUT(request('trailer', 'https://cdn.test/episode.mp4'), { params: Promise.resolve({ id: '7' }) })
        expect(response.status).toBe(200)
        expect(mocks.projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trailerUrl: 'https://cdn.test/episode.mp4', trailerDuration: null }) }))
    })

    it('rejects media that does not belong to the project', async () => {
        const response = await PUT(request('cover', 'https://attacker.test/image.png'), { params: Promise.resolve({ id: '7' }) })
        expect(response.status).toBe(422)
        expect(mocks.projectUpdate).not.toHaveBeenCalled()
    })
})
