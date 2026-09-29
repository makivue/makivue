import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { supersedeEpJobShots } from '@/lib/episodeJobStore'
import { supersedeEpisodeStoryboardDataInTransaction } from './episode-storyboard-replacement'

describe('episode storyboard replacement lifecycle', () => {
    const root = process.cwd()
    const route = fs.readFileSync(path.join(root, 'src/app/api/ai/storyboard/route.ts'), 'utf8')
    const replacement = fs.readFileSync(path.join(root, 'src/services/episode-storyboard-replacement.ts'), 'utf8')
    const epJobStore = fs.readFileSync(path.join(root, 'src/lib/episodeJobStore.ts'), 'utf8')
    const generateAll = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
    const episodePage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('turns every obsolete shot into a non-error replacement record', () => {
        const shots = supersedeEpJobShots(
            [
                { storyboardId: '1', order: 1, status: 'failed', failedStage: 'video', errorMsg: 'provider failed' },
                { storyboardId: '2', order: 2, status: 'video_running', stageStartedAt: 123 },
                { storyboardId: '3', order: 3, status: 'video_done' }
            ],
            '旧分镜已替换'
        )
        expect(shots).toHaveLength(3)
        expect(shots.every(shot => shot.status === 'skipped' && shot.errorMsg === '旧分镜已替换')).toBe(true)
        expect(shots.every(shot => shot.failedStage === undefined && shot.stageStartedAt === undefined)).toBe(true)
    })

    it('claims the episode and clears the old graph in one locked transaction', () => {
        expect(route).toContain('SELECT id FROM episodes WHERE id = ${episodeId} FOR UPDATE')
        expect(route).toContain('await supersedeEpisodeStoryboardDataInTransaction(tx, episodeId')
        expect(route.indexOf('await supersedeEpisodeStoryboardDataInTransaction(tx, episodeId')).toBeLessThan(route.indexOf("data: { status: 'storyboarding'"))
        expect(replacement).toContain("phase: 'cancelled'")
        expect(replacement).toContain('supersedeEpJobShots(job.shots, reason)')
        expect(replacement).toContain('deletedAt: new Date()')
        expect(replacement).toContain('await tx.videoMerge.deleteMany')
        expect(replacement).toContain('await tx.qualityReview.deleteMany')
        expect(replacement).toContain('await tx.productionEvent.deleteMany')
    })

    it('prevents late callbacks from repainting cancelled jobs as failures', () => {
        expect(epJobStore).toContain("if (!row || row.phase !== 'running') return")
        expect(epJobStore).toContain("where: { id: BigInt(id), phase: 'running' }")
        expect(generateAll).not.toContain("new Error('已取消')")
        expect(generateAll).toContain('throw new CancelledError()')
    })

    it('removes old storyboard cards immediately after the replacement is accepted', () => {
        expect(episodePage).toContain('function clearEpisodeStoryboardsInView()')
        expect(episodePage).toContain('storyboards: []')
        expect(episodePage).toContain('if (hasStoryboards) clearEpisodeStoryboardsInView()')
        expect(episodePage).toContain('立即停止本集旧任务')
    })

    it('detaches every media product while retaining upstream text reviews', async () => {
        const tx = {
            episode: { findUnique: vi.fn().mockResolvedValue({ videoUrl: 'https://media/episode.mp4' }), update: vi.fn() },
            storyboard: {
                findMany: vi
                    .fn()
                    .mockResolvedValue([
                        {
                            id: 9n,
                            firstFrameUrl: 'https://media/frame.png',
                            videoUrl: 'https://media/shot.mp4',
                            subtitles: '{"zh":"https://media/shot.srt"}',
                            generations: [{ type: 'middle_frame', resultUrl: 'https://media/middle.png' }]
                        }
                    ]),
                updateMany: vi.fn()
            },
            videoMerge: { findMany: vi.fn().mockResolvedValue([{ videoUrl: 'https://media/merge.mp4', subtitleUrls: '{"en":"https://media/merge.srt"}' }]), deleteMany: vi.fn() },
            epJob: { findMany: vi.fn().mockResolvedValue([{ id: 7n, shots: [{ storyboardId: '9', order: 1, status: 'video_running' }] }]), updateMany: vi.fn() },
            batchJob: { updateMany: vi.fn() },
            generation: { updateMany: vi.fn() },
            qualityReview: { deleteMany: vi.fn() },
            productionEvent: { deleteMany: vi.fn() },
            characterStateEvent: { updateMany: vi.fn() }
        }
        const result = await supersedeEpisodeStoryboardDataInTransaction(tx as never, 2n)
        expect(result.epJobIds).toEqual([7n])
        expect(result.artifacts.map(item => item.url)).toEqual(expect.arrayContaining(['https://media/episode.mp4', 'https://media/merge.srt', 'https://media/middle.png', 'https://media/shot.srt']))
        expect(tx.episode.update).toHaveBeenCalledWith({ where: { id: 2n }, data: { videoUrl: null } })
        expect(tx.storyboard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date), operationVersion: { increment: 1 } }) }))
        expect(tx.generation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', activeKey: null }) }))
        const reviewScope = tx.qualityReview.deleteMany.mock.calls.find(([args]) => args.where.storyboardId === null)?.[0].where.scope.in
        expect(reviewScope).toContain('storyboard')
        expect(reviewScope).not.toContain('chapter')
        expect(reviewScope).not.toContain('script')
        expect(tx.characterStateEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'superseded' } }))
    })
})
