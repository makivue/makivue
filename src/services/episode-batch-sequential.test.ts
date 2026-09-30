vi.mock('@/lib/local-store', () => ({ localTransactionLock: async () => [{ acquired: 1 }] }))
import { POST } from '@/app/api/episodes/[id]/generate-all/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    episode: { findFirst: vi.fn(), findUnique: vi.fn() },
    storyboard: { findFirst: vi.fn(), updateMany: vi.fn() },
    generation: { findUnique: vi.fn(), updateMany: vi.fn() },
    generateFrame: vi.fn(),
    generateVideo: vi.fn(),
    resetEpisodeGeneratedMedia: vi.fn(),
    cancelled: false,
    createEpJob: vi.fn(),
    finalizeEpJob: vi.fn(),
    updateShot: vi.fn()
}))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/prisma', () => {
    const prisma = {
        episode: mocks.episode,
        storyboard: mocks.storyboard,
        generation: mocks.generation,
        $queryRaw: vi.fn(),
        $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(prisma)
    }
    return { prisma }
})
vi.mock('@/lib/utils', () => ({
    apiResponse: (data: unknown) => Response.json({ success: true, data }),
    apiError: (error: string, status = 400) => Response.json({ success: false, error }, { status }),
    apiErrorWithDetails: (error: string, status: number) => Response.json({ success: false, error }, { status })
}))
vi.mock('@/lib/himodels-usage-context.server', () => ({ withHiModelsUsageScope: (_scope: unknown, work: () => Promise<void>) => work() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 1n }))
vi.mock('@/lib/ownership', () => ({ assertEpisodeOwner: async () => null }))
vi.mock('@/lib/id', () => ({ genId: () => 100n }))
vi.mock('@/services/ai', () => ({
    CancelledError: class extends Error {},
    isCancelledError: () => false,
    isImageProvider: (provider: unknown) => provider === 'banana',
    generateFrame: mocks.generateFrame,
    generateVideo: mocks.generateVideo
}))
vi.mock('@/lib/episodeJobStore', () => ({
    createEpJob: mocks.createEpJob,
    finalizeEpJob: mocks.finalizeEpJob,
    updateShot: mocks.updateShot,
    getActiveEpJobForEpisode: async () => null,
    getEpJobSignal: () => new AbortController().signal,
    heartbeatEpJob: async () => {},
    isEpJobCancelled: async () => mocks.cancelled
}))
vi.mock('@/services/production-observability', () => ({ reconcileGenerationTelemetry: async () => {}, runProjectQualityReview: async () => {} }))
vi.mock('@/services/billing', () => ({ BillingError: class extends Error {}, assertSufficientPoints: async () => {}, quoteGenerationPoints: () => 1 }))
vi.mock('@/services/video-language', () => ({ getConfiguredVideoLanguage: async () => 'zh', getDialogueSpeakerNames: () => [] }))
vi.mock('@/services/storyboard-continuity', () => ({ refreshEpisodeStoryboardContinuity: async () => {} }))
vi.mock('@/services/banana', () => ({ assertNanoBananaCredentialsConfigured: () => {} }))
vi.mock('@/services/artifacts', () => ({
    StaleStoryboardMutationError: class extends Error {},
    resetEpisodeGeneratedMedia: mocks.resetEpisodeGeneratedMedia,
    resetStoryboardMediaInTransaction: async (_tx: unknown, shot: unknown) => shot
}))
vi.mock('@/lib/generation-concurrency', () => ({
    getGenerationCategory: (type: string) => (type === 'video' ? 'video' : 'image'),
    waitForGenerationQueueAdmission: async ({ data }: { data: unknown }) => data,
    tryClaimGenerationSlot: async () => 'claimed',
    waitForGenerationSlot: async () => true
}))

function makeShot(order: number, continuityMode = 'independent') {
    return {
        id: BigInt(order),
        episodeId: 10n,
        order,
        sceneId: 20n,
        continuityGroup: 1,
        continuityMode,
        operationVersion: 0,
        duration: 5,
        actionDesc: `Opening state: state ${order - 1}; Ending state: state ${order}`,
        imagePrompt: 'A quiet room',
        firstFrameUrl: null as string | null,
        plannedLastFrameUrl: null,
        actualVideoEndFrameUrl: null as string | null,
        videoUrl: null as string | null,
        videoStatus: 'pending',
        characters: [],
        scene: { timeOfDay: 'day' }
    }
}

let shots: ReturnType<typeof makeShot>[]
let events: string[]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.cancelled = false
    shots = [makeShot(1), makeShot(2, 'stateful'), makeShot(3)]
    events = []
    mocks.episode.findFirst.mockImplementation(async () => ({ id: 10n, projectId: 30n, project: { id: 30n }, operationVersion: 0, storyboards: structuredClone(shots) }))
    mocks.episode.findUnique.mockResolvedValue({ operationVersion: 0 })
    mocks.resetEpisodeGeneratedMedia.mockImplementation(async () => {
        for (const shot of shots) shot.operationVersion += 1
    })
    mocks.storyboard.findFirst.mockImplementation(async ({ where }) => {
        const shot = where.id ? shots.find(shot => shot.id === where.id) : shots.filter(shot => shot.order < where.order.lt).at(-1)
        return shot ? structuredClone(shot) : null
    })
    mocks.storyboard.updateMany.mockImplementation(async ({ where, data }) => {
        const shot = shots.find(shot => shot.id === where.id)
        if (shot) Object.assign(shot, data)
        return { count: shot ? 1 : 0 }
    })
    mocks.generation.findUnique.mockResolvedValue({ errorMsg: 'provider failed' })
    mocks.createEpJob.mockImplementation(async (_projectId, _episodeId, todo) => ({ id: 'batch', total: todo.length, shots: todo }))
    mocks.generateFrame.mockImplementation(async (_id, shot) => {
        events.push(`frame:${shot.order}`)
        shots.find(item => item.id === shot.id)!.firstFrameUrl = `frame-${shot.order}`
        return true
    })
    mocks.generateVideo.mockImplementation(async (_id, shot) => {
        events.push(`video:${shot.order}`)
        Object.assign(
            shots.find(item => item.id === shot.id)!,
            { videoStatus: 'completed', videoUrl: `video-${shot.order}`, actualVideoEndFrameUrl: `tail-${shot.order}` }
        )
    })
})

async function startBatch(mode = 'missing') {
    const response = await POST(
        new Request('http://localhost/api/episodes/10/generate-all', {
            method: 'POST',
            body: JSON.stringify({ mode, videoProvider: 'wan3', imageProvider: 'banana', imageQuality: 'standard' })
        }) as never,
        { params: Promise.resolve({ id: '10' }) }
    )
    expect(await response.json()).toMatchObject({ success: true })
    return mocks.after.mock.calls[0][0] as () => Promise<void>
}

describe('sequential episode media generation', () => {
    it.each(['missing', 'all'])('waits for video and tail persistence before the next frame in %s mode', async mode => {
        let finishVideo!: () => void
        const videoGate = new Promise<void>(resolve => {
            finishVideo = resolve
        })
        const generateVideo = mocks.generateVideo.getMockImplementation()!
        mocks.generateVideo.mockImplementationOnce(async (...args) => {
            events.push('video:1:waiting')
            await videoGate
            await generateVideo(...args)
        })
        const run = await startBatch(mode)
        const execution = run()
        try {
            await vi.waitFor(() => expect(events).toEqual(['frame:1', 'video:1:waiting']))
            expect(mocks.generateFrame).toHaveBeenCalledTimes(1)
        } finally {
            finishVideo()
            await execution
        }
        expect(events).toEqual(['frame:1', 'video:1:waiting', 'video:1', 'frame:2', 'video:2', 'frame:3', 'video:3'])
        expect(mocks.generateFrame.mock.calls[1][3]).not.toHaveProperty('previousShotFrameUrl')
        expect(mocks.finalizeEpJob).toHaveBeenCalledWith('batch', 'done')
    })

    it('ignores legacy continuity anchors', async () => {
        shots[1].continuityMode = 'continuous'
        await (
            await startBatch()
        )()
        expect(events).toEqual(['frame:1', 'video:1', 'frame:2', 'video:2', 'frame:3', 'video:3'])
        expect(mocks.generateFrame.mock.calls[1][3]).not.toHaveProperty('previousContinuityMode')
    })

    it.each(['stateful', 'continuous', 'seamless'])('continues a legacy %s successor after video failure', async continuityMode => {
        shots[1].continuityMode = continuityMode
        mocks.generateVideo.mockImplementationOnce(async () => {
            events.push('video:1:failed')
        })
        await (
            await startBatch()
        )()
        expect(events).toEqual(['frame:1', 'video:1:failed', 'frame:2', 'video:2', 'frame:3', 'video:3'])
        expect(mocks.updateShot).toHaveBeenCalledWith('batch', '2', expect.objectContaining({ status: 'video_done' }))
    })

    it('does not start the next shot after cancellation during a video', async () => {
        mocks.generateVideo.mockImplementationOnce(async () => {
            mocks.cancelled = true
        })
        await (
            await startBatch()
        )()
        expect(mocks.generateFrame).toHaveBeenCalledTimes(1)
        expect(mocks.finalizeEpJob).toHaveBeenCalledWith('batch', 'cancelled')
        expect(mocks.updateShot.mock.calls.some(([, , patch]) => patch.status === 'failed')).toBe(false)
    })

    it('continues other shots after an illustration fails', async () => {
        mocks.generateFrame.mockResolvedValueOnce(false)
        await (
            await startBatch()
        )()
        expect(events).toEqual(['frame:2', 'video:2', 'frame:3', 'video:3'])
        expect(mocks.updateShot).toHaveBeenCalledWith('batch', '1', expect.objectContaining({ status: 'failed', failedStage: 'frame' }))
        expect(mocks.updateShot).toHaveBeenCalledWith('batch', '2', expect.objectContaining({ status: 'video_done' }))
    })

    it('finishes with an error when every illustration fails', async () => {
        mocks.generateFrame.mockResolvedValue(false)
        await (
            await startBatch()
        )()
        expect(mocks.generateFrame).toHaveBeenCalledTimes(3)
        expect(mocks.generateVideo).not.toHaveBeenCalled()
        expect(mocks.finalizeEpJob).toHaveBeenCalledWith('batch', 'error')
    })

    it('does not submit a video when cancelled after its illustration', async () => {
        mocks.generateFrame.mockImplementationOnce(async () => {
            mocks.cancelled = true
            return true
        })
        await (
            await startBatch()
        )()
        expect(mocks.generateFrame).toHaveBeenCalledTimes(1)
        expect(mocks.generateVideo).not.toHaveBeenCalled()
        expect(mocks.finalizeEpJob).toHaveBeenCalledWith('batch', 'cancelled')
    })

    it('reuses completed shots when resuming missing media', async () => {
        Object.assign(shots[0], { firstFrameUrl: 'saved-frame', videoUrl: 'saved-video', videoStatus: 'completed', actualVideoEndFrameUrl: 'saved-tail' })
        shots[1].firstFrameUrl = 'saved-second-frame'
        await (
            await startBatch()
        )()
        expect(events).toEqual(['video:2', 'frame:3', 'video:3'])
        expect(mocks.createEpJob.mock.calls[0][2].map((shot: { order: number }) => shot.order)).toEqual([2, 3])
    })
})
