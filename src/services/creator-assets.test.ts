import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { serializeCreatorAsset } from './creator-assets'

describe('creator assets', () => {
    it('serializes bigint ids and timestamps for the client', () => {
        expect(
            serializeCreatorAsset({
                id: 123n,
                type: 'video',
                url: 'https://cdn.example/video.mp4',
                coverUrl: 'https://cdn.example/cover.jpg',
                prompt: 'test',
                provider: 'seedance',
                ratio: '16:9',
                duration: 5,
                createdAt: new Date('2026-07-25T00:00:00.000Z')
            })
        ).toEqual({
            id: '123',
            type: 'video',
            url: 'https://cdn.example/video.mp4',
            coverUrl: 'https://cdn.example/cover.jpg',
            prompt: 'test',
            provider: 'seedance',
            ratio: '16:9',
            duration: 5,
            createdAt: '2026-07-25T00:00:00.000Z'
        })
    })

    it('defines ownership, idempotency, and soft-delete fields in the migration', () => {
        const migration = fs.readFileSync(
            path.join(process.cwd(), 'prisma/migrations/20260725_add_creator_assets/migration.sql'),
            'utf8'
        )
        expect(migration).toContain('`user_id` BIGINT NOT NULL')
        expect(migration).toContain('UNIQUE INDEX `uk_creator_asset_source_job`')
        expect(migration).toContain('`deleted_at` DATETIME(3) NULL')
    })

    it('requires the authenticated user for delete and cover updates', () => {
        const deleteRoute = fs.readFileSync(
            path.join(process.cwd(), 'src/app/api/create/assets/[id]/route.ts'),
            'utf8'
        )
        const coverRoute = fs.readFileSync(
            path.join(process.cwd(), 'src/app/api/create/assets/[id]/cover/route.ts'),
            'utf8'
        )
        expect(deleteRoute).toContain('deleteCreatorAsset(userId, assetId)')
        expect(coverRoute).toContain('where: { id: assetId, userId')
    })
})
