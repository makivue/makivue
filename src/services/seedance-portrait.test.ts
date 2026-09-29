import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    characterFindFirst: vi.fn(),
    characterUpdateMany: vi.fn(),
    assetFindUnique: vi.fn(),
    assetCreate: vi.fn(),
    assetUpdate: vi.fn(),
    assetUpdateMany: vi.fn(),
    assetFindMany: vi.fn(),
    createPortraitAsset: vi.fn(),
    getPortraitAssetStatus: vi.fn(),
    getSeedanceConfig: vi.fn(),
    genId: vi.fn(() => 101n)
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        character: {
            findFirst: mocks.characterFindFirst,
            updateMany: mocks.characterUpdateMany
        },
        seedancePortraitAsset: {
            findUnique: mocks.assetFindUnique,
            create: mocks.assetCreate,
            update: mocks.assetUpdate,
            updateMany: mocks.assetUpdateMany,
            findMany: mocks.assetFindMany
        }
    }
}))

vi.mock('@/lib/id', () => ({ genId: mocks.genId }))
vi.mock('./seedance-assets', () => ({
    createSeedancePortraitAsset: mocks.createPortraitAsset,
    getSeedancePortraitAssetStatus: mocks.getPortraitAssetStatus
}))
vi.mock('./seedance-config', () => ({ getSeedanceConfig: mocks.getSeedanceConfig }))

import { refreshCharacterSeedancePortraitAssets, submitCharacterSeedancePortraitAsset } from './seedance-portrait'

const seedanceConfig = { apiKey: 'key', baseUrl: null, modelName: null, extra: null }

describe('Seedance trusted portrait persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getSeedanceConfig.mockResolvedValue(seedanceConfig)
    })

    it('persists the unique Asset ID returned for each uploaded role', async () => {
        mocks.characterFindFirst.mockResolvedValue({
            name: 'Actor',
            seedanceAssetGroupId: 'group-trusted',
            seedancePortraitStatus: 'authorized'
        })
        mocks.assetFindUnique.mockResolvedValue(null)
        mocks.assetCreate.mockImplementation(async ({ data }) => ({ ...data, name: 'actor-face', id: 101n }))
        mocks.createPortraitAsset.mockResolvedValue({ assetId: 'asset-face-unique', projectName: 'moviebox' })
        mocks.assetUpdate.mockResolvedValue({})

        await expect(
            submitCharacterSeedancePortraitAsset(1n, {
                sourceUrl: 'https://cdn.example.com/face.png',
                role: 'face'
            })
        ).resolves.toEqual({ status: 'created' })

        expect(mocks.createPortraitAsset).toHaveBeenCalledWith(seedanceConfig, {
            groupId: 'group-trusted',
            sourceUrl: 'https://cdn.example.com/face.png',
            name: 'actor-face'
        })
        expect(mocks.assetUpdate).toHaveBeenCalledWith({
            where: { id: 101n },
            data: {
                assetId: 'asset-face-unique',
                projectName: 'moviebox',
                status: 'processing',
                errorMsg: null
            }
        })
    })

    it('promotes a reviewed Asset ID to the character automatically', async () => {
        mocks.assetFindMany
            .mockResolvedValueOnce([
                {
                    id: 101n,
                    assetId: 'asset-face-unique',
                    groupId: 'group-trusted',
                    projectName: 'moviebox'
                }
            ])
            .mockResolvedValueOnce([
                {
                    assetId: 'asset-face-unique',
                    role: 'face',
                    updatedAt: new Date('2026-08-16T00:00:00Z')
                }
            ])
        mocks.getPortraitAssetStatus.mockResolvedValue({
            assetId: 'asset-face-unique',
            groupId: 'group-trusted',
            projectName: 'moviebox',
            status: 'Active'
        })
        mocks.assetUpdate.mockResolvedValue({})
        mocks.characterUpdateMany.mockResolvedValue({ count: 1 })

        await refreshCharacterSeedancePortraitAssets(1n, seedanceConfig)

        expect(mocks.assetUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 101n },
                data: expect.objectContaining({ status: 'active' })
            })
        )
        expect(mocks.characterUpdateMany).toHaveBeenCalledWith({
            where: { id: 1n, deletedAt: null },
            data: { seedanceAssetId: 'asset-face-unique', seedancePortraitStatus: 'authorized' }
        })
    })
})
