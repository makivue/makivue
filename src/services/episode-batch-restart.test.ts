import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode batch restart after page-level pause', () => {
    const root = process.cwd()
    const page = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const modal = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx'), 'utf8')
    const cancelRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/cancel/route.ts'), 'utf8')
    const cancelHelper = fs.readFileSync(path.join(root, 'src/lib/cancel-episode-batch.ts'), 'utf8')
    const generateRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
    const episodeRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/route.ts'), 'utf8')

    it('cancels the running episode job when the page-level pause is used', () => {
        expect(page).toContain('`/api/episodes/${episodeId}/generate-all/cancel`')
        expect(cancelRoute).toContain("where: { episodeId, phase: 'running' }")
        expect(cancelRoute).toContain('await cancelEpisodeBatchJob(job)')
        expect(cancelHelper).toContain('await cancelEpJob(job.id)')
        expect(cancelHelper).toContain("status: 'queued'")
        expect(cancelHelper).toContain("status: 'processing'")
        expect(cancelHelper).toContain("data: { errorMsg:")
        expect(cancelHelper).toContain('operationVersion: { increment: 1 }')
    })

    it('keeps in-flight requests in their slots while making their UI state stale', () => {
        expect(cancelHelper).not.toContain("where: { storyboardId: { in: storyboardIds }, status: { in: ['queued', 'processing'] } }")
        expect(generateRoute).toContain('resourceVersion: sb.operationVersion')
        expect(generateRoute).toContain('resourceVersion: shot.operationVersion')
        expect(generateRoute).toContain('signal')
        expect(episodeRoute).toContain('generation.resourceVersion === sb.operationVersion')
    })

    it('always resumes only missing media after a successful pause', () => {
        expect(page).not.toContain('restartBatchFromScratch')
        expect(page).toContain("openEpisodeBatch('missing')")
        expect(page).toContain('setActiveEpisodeBatchJobId(jobId)')
        expect(page).toContain('videoProvider={globalVideoProvider}')
        expect(modal).toContain('body: JSON.stringify({ mode: requestMode')
        expect(modal).toContain("setRequestMode('missing')")
        expect(modal).toContain('重试未完成')
        expect(generateRoute).toContain('const needFrame = !sb.firstFrameUrl')
        expect(generateRoute).toContain('const needVideo = !sb.videoUrl')
        expect(generateRoute).toContain("await updateShot(job.id, sb.id.toString(), { status: 'frame_done' })")
    })

    it('does not restart the generation request when the parent callback changes identity', () => {
        expect(modal).toContain('const onStartedRef = useRef(onStarted)')
        expect(modal).toContain('onStartedRef.current?.(nextJobId, json.data?.resetApplied === true)')
        expect(modal).toContain('startBatchOnce(startKey')
        expect(modal).toContain('}, [episodeId, requestId, imageProvider, imageQuality, videoProvider, requestMode, retryKey])')
        expect(page).toContain('requestId={episodeBatchRequestId}')
    })
})
