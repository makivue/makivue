import { beforeEach, describe, expect, it, vi } from 'vitest'
import { walletTransactionDestinations } from './wallet-transaction-destinations'

const mocks = vi.hoisted(() =>
    Object.fromEntries(
        ['generation', 'creatorAsset', 'videoMerge', 'refImageJob', 'project', 'projectAiJob', 'outlineJob', 'extractJob', 'chapterJob', 'scriptJob', 'storyboardJob', 'episode'].map(name => [
            name,
            { findMany: vi.fn() }
        ])
    )
)
vi.mock('@/lib/prisma', () => ({ prisma: mocks }))
const source = (sourceType: string, sourceId: string) => ({ type: 'usage', sourceType, sourceId })
const episode = { id: 20n, projectId: 10n }

beforeEach(() => {
    for (const model of Object.values(mocks)) model.findMany.mockReset().mockResolvedValue([])
})

describe('wallet transaction destinations', () => {
    it('resolves generations through their storyboard and scopes all ancestors to the owner', async () => {
        mocks.generation.findMany.mockResolvedValue([
            { id: 50n, storyboard: { id: 30n, episode } },
            { id: 51n, storyboard: { id: 31n, episode } }
        ])
        const paths = await walletTransactionDestinations(7n, [source('generation', '50'), source('generation', '51'), source('generation', '50')])
        expect(paths.get('generation:50')).toBe('/projects/10/episodes/20#shot-30')
        expect(paths.get('generation:51')).toBe('/projects/10/episodes/20#shot-31')
        expect(mocks.generation.findMany).toHaveBeenCalledOnce()
        expect(mocks.generation.findMany.mock.calls[0][0].where).toEqual({
            id: { in: [50n, 51n] },
            storyboard: { deletedAt: null, episode: { deletedAt: null, project: { userId: 7n, deletedAt: null } } }
        })
    })

    it('uses creator job IDs to resolve the asset, including older assets outside the first gallery page', async () => {
        mocks.creatorAsset.findMany.mockResolvedValue([
            { id: 80n, sourceJobId: 60n, type: 'image' },
            { id: 81n, sourceJobId: 61n, type: 'video' }
        ])
        const paths = await walletTransactionDestinations(7n, [source('creator_image', '60'), source('creator_video', '61')])
        expect(paths.get('creator_image:60')).toBe('/aiimage?assetId=80')
        expect(paths.get('creator_video:61')).toBe('/aivideo?assetId=81')
        expect(mocks.creatorAsset.findMany.mock.calls[0][0].where).toEqual({ userId: 7n, deletedAt: null, sourceJobId: { in: [60n, 61n] } })
    })

    it('omits links for deleted, foreign, malformed or unsupported sources and recharge orders', async () => {
        const paths = await walletTransactionDestinations(7n, [
            source('generation', '50'),
            source('generation', 'invalid'),
            source('creator_image', '60'),
            source('unknown', '1'),
            { ...source('generation', '2'), type: 'recharge' }
        ])
        expect(paths.size).toBe(0)
        expect(mocks.generation.findMany.mock.calls[0][0].where.id.in).toEqual([50n])
    })

    it('checks project ownership for jobs without Prisma relations and resolves episode jobs', async () => {
        mocks.projectAiJob.findMany.mockResolvedValue([
            { id: 90n, projectId: 10n },
            { id: 91n, projectId: 11n }
        ])
        mocks.project.findMany.mockResolvedValue([{ id: 10n }])
        mocks.scriptJob.findMany.mockResolvedValue([{ id: 92n, episode }])
        mocks.videoMerge.findMany.mockResolvedValue([{ id: 93n, episode }])
        const paths = await walletTransactionDestinations(7n, [source('project_style_reference', 'project-style:90'), source('llm_job', '91'), source('llm_job', '92'), source('video_merge', '93')])
        expect(paths.get('project_style_reference:project-style:90')).toBe('/projects/10?tab=novel')
        expect(paths.has('llm_job:91')).toBe(false)
        expect(paths.get('llm_job:92')).toBe('/projects/10/episodes/20#episode-script')
        expect(paths.get('video_merge:93')).toBe('/projects/10/episodes/20#episode-finished')
        expect(mocks.project.findMany.mock.calls[0][0].where).toMatchObject({ userId: 7n, deletedAt: null })
    })
})
