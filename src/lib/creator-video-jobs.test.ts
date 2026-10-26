import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from './prisma'
import { createCreatorGenerationJob } from './creator-generation-concurrency'

let directory: string
const originalDataDirectory = process.env.LOCAL_DATA_DIR
const input = { input: { assetIds: ['11', '12'], title: 'Local movie', ratio: '16:9', requestKey: 'a1234567-1234-1234-1234-123456789012' }, requestKey: 'a1234567-1234-1234-1234-123456789012' }

describe('creator video jobs in the local JSON workspace', () => {
    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creator-video-jobs-test-'))
        process.env.LOCAL_DATA_DIR = directory
    })
    afterEach(async () => {
        if (originalDataDirectory === undefined) delete process.env.LOCAL_DATA_DIR
        else process.env.LOCAL_DATA_DIR = originalDataDirectory
        await fs.rm(directory, { recursive: true, force: true })
    })

    it('deduplicates simultaneous merge submissions under the workspace lock', async () => {
        const [first, second] = await Promise.all([createCreatorGenerationJob(1n, 'video_merge', input), createCreatorGenerationJob(1n, 'video_merge', input)])
        expect(first.id).toBe(second.id)
        const rows = await prisma.projectAiJob.findMany({ where: { kind: 'creator_video_merge' } })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ phase: 'queued', leaseOwner: null, leaseExpiresAt: null, result: input })
        const conflicting = { ...input, input: { ...input.input, title: 'Changed movie' } }
        await expect(createCreatorGenerationJob(1n, 'video_merge', conflicting)).rejects.toThrow('请求编号已用于其它内容')
    })

    it('keeps theme planning capacity separate from video and merge jobs', async () => {
        await createCreatorGenerationJob(1n, 'video_plan')
        await createCreatorGenerationJob(1n, 'video_plan')
        await expect(createCreatorGenerationJob(1n, 'video_plan')).rejects.toMatchObject({ category: 'video_plan', limit: 2 })
        await expect(createCreatorGenerationJob(1n, 'video')).resolves.toMatchObject({ active: 1, limit: 20 })
        await expect(createCreatorGenerationJob(1n, 'video_merge', input)).resolves.toMatchObject({ active: 1, limit: 2 })
    })
})
