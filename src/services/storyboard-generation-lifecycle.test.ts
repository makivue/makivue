import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('storyboard generation request lifecycle', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/services/storyboard-generation-handler.ts'), 'utf8')
    const episodeRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/episodes/[id]/route.ts'), 'utf8')
    const cancelRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/storyboards/[id]/generate/cancel/route.ts'), 'utf8')
    const episodePage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const concurrency = fs.readFileSync(path.join(process.cwd(), 'src/lib/generation-concurrency.ts'), 'utf8')
    const capacityRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/generate/capacity/route.ts'), 'utf8')

    it('returns before starting long image and video work', () => {
        expect(route).toContain("import { after, NextRequest } from 'next/server'")
        expect(route).toContain('after(async () => {')
        expect(route.indexOf('after(async () => {')).toBeLessThan(route.lastIndexOf('return apiResponse('))
        expect(route).not.toContain('void task')
    })

    it('rejects manual image/video overflow while preserving durable queueing', () => {
        expect(route).toContain("status: 'queued'")
        expect(route).toContain('tryClaimGenerationSlot')
        expect(route).toContain('waitForGenerationSlot')
        expect(route).toContain('queued: !slotClaimed')
        expect(route).toContain("code: 'GENERATION_CONCURRENCY_LIMIT'")
        expect(route).toContain('if (!slotClaimed)')
        expect(route).not.toContain('generationRateLimitError')
    })

    it('claims a slot atomically across application instances', () => {
        expect(concurrency).toContain('GET_LOCK')
        expect(concurrency).toContain('RELEASE_LOCK')
        expect(concurrency).toContain('projectActive >= limits.project')
        expect(concurrency).toContain('userActive >= limits.user')
        expect(concurrency).toContain("distinct: ['storyboardId']")
        expect(concurrency).toContain('activeReferences.length')
    })

    it('checks user capacity before changing manual image or video button state', () => {
        expect(capacityRoute).toContain('getUserGenerationCapacity(userId, category)')
        expect(episodePage).toContain('fetchGenerationCapacity(category)')

        const frameHandler = episodePage.slice(episodePage.indexOf('async function generateHeaderIllustrations()'), episodePage.indexOf('async function generateVideo('))
        expect(frameHandler.indexOf("await canStartGeneration('image')")).toBeLessThan(frameHandler.indexOf('setSubmittingFrame(true)'))

        const videoHandler = episodePage.slice(episodePage.indexOf('async function generateVideo('), episodePage.indexOf('async function generateHeaderVideo()'))
        expect(videoHandler.indexOf("await canStartGeneration('video')")).toBeLessThan(videoHandler.indexOf('setSubmittingVideo(true)'))
        expect(videoHandler).toContain("onReleaseGenerationCapacity('video')")
        expect(episodePage).toContain('tryReserveGenerationCapacity({')
        expect(episodePage).toContain('generationCapacityReservationsRef.current')
        expect(episodePage).toContain('<GenerationCapacityDialog')
        expect(episodePage).toContain('setGenerationCapacityNotice({')
        expect(episodePage).toContain("json?.code === 'GENERATION_CONCURRENCY_LIMIT'")
        expect(episodePage).toContain('showGenerationCapacityNotice(capacityCategory, text)')
    })

    it('persists an actionable failure when preparation fails before provider submission', () => {
        expect(route).toContain("status: 'failed', errorMsg: message")
        expect(route).toContain("type === 'video'")
        expect(route).toContain("{ videoStatus: 'failed' }")
    })

    it('keeps the child frame failure when an illustration group stops at its first image', () => {
        expect(route).toContain('const firstFrameFailure = await prisma.generation.findUnique({')
        expect(route).toContain("firstFrameFailure?.errorMsg?.trim() || '主插图生成失败，未继续生成插图组'")
    })

    it('returns the latest persisted failure even when compact generation history omits it', () => {
        expect(episodeRoute).toContain('const [failedGenerationRows, generationUsage] = await Promise.all([')
        expect(episodeRoute).toContain("status: 'failed'")
        expect(episodeRoute).toContain('const latestFailedGeneration = new Map')
        expect(episodeRoute).toContain('latestFailedGeneration.get(`${sb.id}:${type}`)')
    })

    it('keeps queued work active across refresh and lets the user cancel it', () => {
        expect(episodeRoute).toContain('where: episodeStatusGenerationWhere')
        expect(fs.readFileSync(path.join(process.cwd(), 'src/services/episode-status.ts'), 'utf8')).toContain("status: { in: ['queued', 'processing'] }")
        expect(episodeRoute).toContain("status === 'queued' || status === 'processing'")
        expect(cancelRoute).toContain("status: { in: ['queued', 'processing'] }")
    })

    it('shows a distinct queued state instead of another rate-limit error', () => {
        expect(episodePage).toContain("sb.latestVideoRequest?.status === 'queued'")
        expect(episodePage).toContain('排队中（等待生成名额）')
        expect(episodePage).toContain('本任务已排队：单作品最多同时')
        expect(episodePage).toContain('这个分镜已有')
        expect(episodePage).toContain("errorPayload?.code === 'GENERATION_CONCURRENCY_LIMIT'")
    })

    it('shows synchronous and polled single-shot failures without requiring the card to be expanded', () => {
        expect(episodePage).toContain("else pushToast('error', text)")
        expect(episodePage).toContain("pushToast('error', `生成请求失败：${message}`)")
        expect(episodePage).toContain('collectStoryboardGenerationFailureNotices({')
        expect(episodePage).toContain("sb.frameStatus === 'failed' && !frameReady")
        expect(episodePage).toContain("frameError?.errorMsg ?? t('插图生成失败')")
    })

    it('deduplicates only retries of the same request and never reuses an older active task', () => {
        expect(episodePage).toContain('const requestId = crypto.randomUUID()')
        expect(route).toContain('const sameRequestGeneration = await prisma.generation.findUnique({ where: { activeKey } })')
        expect(route).toContain("code: 'GENERATION_ALREADY_ACTIVE'")
        expect(route).toContain('本次请求没有复用旧结果')
    })
})
