import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { extractionActiveKey } from '@/lib/extract-fingerprint'
import { getVisualStyleProfile, parseNovelSetup } from '@/lib/novel'

const mocks = vi.hoisted(() => ({ job: vi.fn(), scripts: vi.fn(), project: vi.fn(), transaction: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { extractJob: { findFirst: mocks.job }, episode: { findMany: mocks.scripts }, project: { findFirst: mocks.project }, $transaction: mocks.transaction } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 1n }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: async () => null }))
vi.mock('@/services/extracted-entities', () => ({ clearProjectExtractedEntitiesInTransaction: mocks.clear }))
import { POST } from './route'

describe('extraction commits after upstream regeneration', () => {
    const scripts = [{ episodeNumber: 1, script: '原剧本' }]
    const job = { id: 2n, phase: 'done', committedAt: null, activeKey: extractionActiveKey('1', scripts, getVisualStyleProfile(parseNovelSetup(null))).activeKey }

    beforeEach(() => {
        vi.resetAllMocks()
        mocks.job.mockResolvedValue(job)
        mocks.scripts.mockResolvedValue(scripts)
        mocks.project.mockResolvedValue({ novelSetup: null })
    })

    it.each([{ scripts: [{ episodeNumber: 1, script: '新剧本' }] }, { scripts: [{ episodeNumber: 1, script: null }] }])(
        'rejects an old result when scripts change while the commit waits for its lock: %j',
        async ({ scripts: lockedScripts }) => {
            const tx = {
                $queryRaw: vi.fn(),
                extractJob: { findUnique: vi.fn().mockResolvedValue(job), update: vi.fn() },
                episode: { findMany: vi.fn().mockResolvedValue(lockedScripts) }
            }
            mocks.transaction.mockImplementation(callback => callback(tx))
            const response = await POST(new NextRequest('http://localhost/api/ai/extract/commit', { method: 'POST', body: JSON.stringify({ projectId: '1', jobId: '2', replaceAll: true }) }))
            expect(response.status).toBe(409)
            expect((await response.json()).error).toContain('旧提取结果已失效')
            expect(mocks.clear).not.toHaveBeenCalled()
            expect(tx.extractJob.update).not.toHaveBeenCalled()
        }
    )
})
