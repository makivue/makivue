import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode batch status persistence', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
    const store = fs.readFileSync(path.join(process.cwd(), 'src/lib/episodeJobStore.ts'), 'utf8')
    const episodePage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const batchModal = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx'), 'utf8')
    const storyboardRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/storyboard/route.ts'), 'utf8')
    const manualStoryboardRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/episodes/[id]/storyboards/route.ts'), 'utf8')

    it('awaits every shot state transition before moving to the next storyboard', () => {
        expect(route.match(/await updateShot\(/g)?.length).toBeGreaterThanOrEqual(6)
        expect(route).not.toMatch(/^\s*updateShot\(/m)
        expect(route).toContain("await updateShot(job.id, sb.id.toString(), { status: 'video_done' })")
    })

    it('atomically finalizes the job instead of racing the last shot update', () => {
        expect(route).toContain("await finalizeEpJob(job.id, [...resultByStoryboardId.values()].some(Boolean) ? 'done' : 'error')")
        expect(route).not.toContain('updateEpJob(job.id, { phase: failed.length')
    })

    it('serializes concurrent shot progress updates so workers cannot overwrite each other', () => {
        expect(store).toContain('$transaction')
        expect(store).toContain('await prisma.$transaction(async tx =>')
    })

    it('projects modal progress onto the outer storyboard list using the same poll snapshot', () => {
        expect(batchModal).toContain('onProgressRef.current?.({ phase: d.phase, shots: d.shots })')
        expect(episodePage).toContain('const syncEpisodeBatchProgress = useCallback(')
        expect(episodePage).toContain('batchStatus={episodeBatchShotStatuses[sb.id]}')
        expect(episodePage).toContain('onProgress={syncEpisodeBatchProgress}')
        expect(episodePage).toContain('if (!activeEpisodeBatchJobId) return')
        expect(episodePage).toContain('if (showBatchModal) return')
        expect(episodePage).toContain('generate-all/status/${activeEpisodeBatchJobId}')
        expect(episodePage).toContain("activeGenerationStatus === 'frame_running'")
        expect(episodePage).toContain("activeGenerationStatus === 'video_running'")
        expect(episodePage).toContain("activeGenerationStatus === 'pending'")
        expect(episodePage).toContain('disabled={(submittingFrame && !frameGenerating) || (batchBusy && !batchFrameRunning)}')
    })

    it('shows pending shots immediately and keeps persisted generating states as a fallback', () => {
        expect(route).toContain('shots: job.shots')
        expect(batchModal).toContain('const initialShots = Array.isArray(json.data?.shots)')
        expect(batchModal).toContain("onProgressRef.current?.({ phase: 'running', shots: initialShots })")
        expect(episodePage).toContain("sb.videoStatus === 'generating'")
        expect(episodePage).toContain("sb.frameStatus === 'generating'")
        expect(batchModal).toContain('getPollingDelay({ baseMs: 7_500, failureCount: consecutiveFailures })')
        expect(batchModal.match(/setPhase\('error'\)/g)).toHaveLength(1)
    })

    it('reports a shot as running only after it has claimed a real provider slot', () => {
        const claim = route.indexOf('const gen1 = await createAndClaimGeneration')
        const running = route.indexOf("await updateShot(job.id, sb.id.toString(), { status: 'frame_running' })")
        expect(claim).toBeGreaterThan(0)
        expect(running).toBeGreaterThan(claim)
    })

    it('keeps batch status compact in the media buttons without duplicate glowing badges', () => {
        expect(episodePage).toContain('disabled={(submittingFrame && !frameGenerating) || (batchBusy && !batchFrameRunning)}')
        expect(episodePage).not.toContain('shadow-[0_0_14px')
        expect(episodePage).not.toContain('{activeGenerationStatus && (')
        expect(episodePage).toContain('const headerIconButtonBase = `${headerButtonBase} is-icon-only`')
        expect(episodePage).toMatch(/const frameHeaderActionLabel = t\(/)
        expect(episodePage).toContain('aria-label={frameHeaderActionLabel}')
        expect(episodePage).toContain('title={frameHeaderActionLabel}')
        expect(episodePage).toMatch(/frameGenerating \|\| submittingFrame \? \(\s*<RefreshCw/)
        expect(episodePage).toContain("const videoGenerating = submittingVideo || batchVideoRunning || (sb.videoStatus === 'generating' && !videoQueued)")
        expect(episodePage).toMatch(/const videoHeaderActionLabel = t\(/)
        expect(episodePage).toContain('aria-label={videoHeaderActionLabel}')
        expect(episodePage).toContain('title={videoHeaderActionLabel}')
        expect(episodePage).toMatch(/videoGenerating \? <RefreshCw/)
        expect(batchModal).toContain("sh.status === 'frame_running'")
        expect(batchModal).toMatch(/\? t\('生成中'\)/)
        expect(episodePage).toContain("activeGenerationStatus === 'pending'")
    })

    it('keeps the episode merge control visible while videos are still running', () => {
        expect(episodePage).toContain('const incompleteVideoCount = storyboards.filter(')
        expect(episodePage).toContain('{storyboards.length > 0 &&')
        expect(episodePage).toContain('disabled={isMerging || !allVideosCompleted}')
        expect(episodePage).toContain('待视频完成 (${incompleteVideoCount})')
    })

    it('surfaces the underlying generation error in both batch progress and the shot list', () => {
        expect(route).toContain('const generationFailureMessage = async')
        expect(route).toContain('select: { errorMsg: true }')
        expect(route).toMatch(/generationFailureMessage\(gen1\.id,/)
        expect(episodePage).toContain('setEpisodeBatchShotErrors(')
        expect(episodePage).toContain('batchError={episodeBatchShotErrors[sb.id]}')
        expect(episodePage).toContain('const batchFailureMessage = batchError ?? frameError?.errorMsg')
        expect(episodePage).toContain('resolveVideoFailureDisplay({')
        expect(episodePage).toContain('{videoFailure.failed && (')
    })

    it('tracks whether a batch failure belongs to the illustration or video stage', () => {
        expect(route).toContain("await markStoryboardFailed(sb, err, 'frame')")
        expect(route).toContain("await markStoryboardFailed(sb, err, 'video')")
        expect(episodePage).toContain('const resolvedBatchFailureStage =')
        expect(episodePage).toContain('const frameSucceeded = frameReady || batchFrameReady')
        expect(episodePage).toContain("resolvedBatchFailureStage === 'video'")
        expect(batchModal).toContain("isFailed && failureStage === 'video'")
    })

    it('uses the shared generation slots instead of bypassing limits with processing rows', () => {
        expect(route).toContain('createAndClaimGeneration')
        expect(route).toContain('tryClaimGenerationSlot')
        expect(route).toContain('waitForGenerationQueueAdmission')
        expect(route).toContain('waitForGenerationSlot')
        expect(route).not.toContain('await assertGenerationQueueCapacity(userId, category)')
        expect(route).toContain('生成队列已满${usage}，正在等待空位；有名额后会自动继续。')
        expect(batchModal).toContain('queueWaitingMessage')
        expect(batchModal).toContain('{sh.errorMsg && (')
        expect(route).not.toContain("type: 'video', provider: videoProvider, status: 'processing'")
        expect(route).toContain('resourceVersion: params.resourceVersion')
    })

    it('only writes generating/completed states for the version claimed by the batch', () => {
        expect(route).toContain('operationVersion: gen1.resourceVersion')
        expect(route).toContain('operationVersion: gen2.resourceVersion')
        expect(route).toContain("data: { status: 'cancelled', activeKey: null, errorMsg:")
    })

    it('runs each complete shot in order while preserving continuity validation', () => {
        expect(route).toContain('const frameReady = await generateStoryboardFrame(sb)')
        expect(route).toContain('const videoReady = await generateStoryboardVideo(sb)')
        expect(route).not.toContain('createConcurrencyLimiter')
        expect(route).not.toContain("generateFrame(genMiddle.id, shotFullMiddle, 'middle_frame'")
        expect(route).not.toContain("generateFrame(genLast.id, shotFullLast, 'last_frame'")
        expect(route.indexOf("generateFrame(gen1.id, sb, 'first_frame'")).toBeLessThan(route.indexOf('generateVideo(gen2.id, shot'))
        expect(route).toContain('sb.plannedLastFrameUrl = null')
    })

    it('deduplicates concurrent batch submissions under a database lock', () => {
        expect(store).toContain('studio-episode-batch:')
        expect(store).toContain('localTransactionLock')
        expect(store).toContain("phase: 'running'")
        expect(route).toContain('if (job.reused)')
    })

    it('recovers a request-bound batch after its executor stops heartbeating', () => {
        expect(store).toContain('export const EP_JOB_STALE_MS = 3 * 60 * 1000')
        expect(store).toContain('await expireEpJob(tx, row, staleBefore,')
        expect(store).toContain("status: { in: ['queued', 'processing'] }")
        expect(store).toContain('activeKey: null')
        expect(route).toContain('const activeBatchJob = await getActiveEpJobForEpisode')
        expect(route).toContain('const heartbeat = setInterval')
        expect(route).toContain('void heartbeatEpJob(job.id)')
        expect(route).toContain('clearInterval(heartbeat)')
        expect(store).toContain("row.phase === 'running' && (isEpJobHeartbeatExpired(row.updatedAt) || isEpJobStageExpired(row.shots, Date.now(), row.createdAt))")
    })

    it('stops a provider stage that remains running even while the batch heartbeat is alive', () => {
        expect(store).toContain('stageStartedAt?: number')
        expect(store).toContain('function isEpJobStageExpired')
        expect(store).toContain("patch.status === 'frame_running' || patch.status === 'video_running'")
        expect(store).toContain('isEpJobHeartbeatExpired(row.updatedAt) || isEpJobStageExpired(row.shots, Date.now(), row.createdAt)')
    })

    it('automatically resumes missing shots once when a deployment interrupts the executor', () => {
        expect(batchModal).toContain('isEpisodeBatchExecutorInterrupted(d)')
        expect(batchModal).toContain('executorRecoveryAttemptsRef.current < 1')
        expect(batchModal).toContain('body: JSON.stringify({ mode: requestMode')
        expect(batchModal).toContain("setRequestMode('missing')")
        expect(episodePage).toContain('resumeInterruptedEpisodeBatch')
        expect(episodePage).toContain("mode: 'missing'")
        expect(episodePage).toContain('recoveredEpisodeBatchJobIds.current.has(interruptedJobId)')
        expect(episodePage).toContain("pushToast('info'")
    })

    it('locks every batch shot to the video model selected by the UI', () => {
        expect(route).toContain('const primaryVideoProvider = videoProviderOverride ?? (await resolveGlobalVideoProvider())')
        expect(route).toContain('const providerForStoryboard = () => videoProvider')
        expect(route).not.toContain('autoModelRouting')
        expect(route).not.toContain('getVideoProviderRoutingFeedback')
    })

    it('refreshes project episode summaries and uses real storyboard counts after AI completion', () => {
        expect(episodePage).toContain('function applyStoryboardCompletion(result: StoryboardJobResult)')
        expect(episodePage).toContain("status: 'storyboarded'")
        expect(episodePage).toContain('_count: { storyboards: Math.max(item._count.storyboards, result.count) }')
        expect(episodePage).toContain('await refreshStoryboardWorkspace()')
        expect(episodePage).toContain('const storyboardedCount = project.episodes.filter(e => e._count.storyboards > 0).length')
        expect(episodePage).toContain('const isStoryboarded = hasSb')
    })

    it('repairs stale episode status whenever real storyboards already exist', () => {
        const runningGuard = storyboardRoute.indexOf("if (episode.status === 'storyboarding')")
        const existingGuard = storyboardRoute.indexOf('if (episode._count.storyboards > 0 && !overwriteExisting)')
        expect(runningGuard).toBeGreaterThan(0)
        expect(existingGuard).toBeGreaterThan(runningGuard)
        expect(storyboardRoute).toContain("data: { status: 'storyboarded' }")
        expect(manualStoryboardRoute).toContain("data: { status: 'storyboarded' }")
    })
})
