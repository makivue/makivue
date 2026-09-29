import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('character and scene extraction job recovery', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/extract/preview/route.ts'), 'utf8')
    const commitRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/extract/commit/route.ts'), 'utf8')
    const store = fs.readFileSync(path.join(process.cwd(), 'src/lib/extractJobStore.ts'), 'utf8')
    const modal = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/ExtractReviewModal.tsx'), 'utf8')
    const novelTab = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/NovelTab.tsx'), 'utf8')
    const llm = fs.readFileSync(path.join(process.cwd(), 'src/services/llm.ts'), 'utf8')

    it('returns the active project job instead of launching and billing a duplicate', () => {
        expect(route.indexOf('const activeJob = await getActiveJob')).toBeLessThan(route.indexOf('await assertSufficientPoints'))
        expect(route).toContain('return apiResponse({ jobId: activeJob.id, resumed: true })')
        expect(route).toContain('if (resumed)')
    })

    it('returns and displays structured API errors instead of failing JSON parsing', () => {
        expect(route).toContain("handleApiError(error, '启动角色与场景提取失败')")
        expect(modal).toContain('readApiJson(res)')
        expect(modal).not.toContain('await res.json()')
    })

    it('repairs a stale project stage when every imported episode already has a script', () => {
        expect(route).toContain('withScripts.length !== project.episodes.length')
        expect(route).toContain("data: { novelStage: 'scripted' }")
        expect(novelTab).toContain('project.episodes.every(episode => episodeHasScript(episode))')
        expect(novelTab).toContain("ui('剧本已全部就绪', 'All scripts ready')")
    })

    it('uses one shared fingerprint implementation for extraction and commit', () => {
        expect(route).toContain("import { extractionActiveKey } from '@/lib/extract-fingerprint'")
        expect(commitRoute).toContain("import { extractionActiveKey } from '@/lib/extract-fingerprint'")
        expect(route).toContain('extractionActiveKey(projectId, project.episodes, visualStyleProfile)')
        expect(commitRoute).toContain('extractionActiveKey(projectId.toString(), currentScripts, visualStyleProfile)')
    })

    it('allows large extraction commits to finish over a remote test database', () => {
        expect(commitRoute).toContain('EXTRACT_COMMIT_TRANSACTION_OPTIONS')
        expect(commitRoute).toContain('maxWait: 10_000')
        expect(commitRoute).toContain('timeout: 60_000')
        expect(commitRoute).toContain("conflict: 'transaction_timeout'")
        expect(commitRoute).toContain('数据库事务超时且已安全回滚，请重试')
    })

    it('serializes concurrent check-and-create requests per project', () => {
        expect(store).toContain('SELECT id FROM projects')
        expect(store).toContain('FOR UPDATE')
        expect(store).toContain("phase: { in: ['analyzing', 'merging'] }")
    })

    it('keeps the job id when the modal closes and restores it on reopen', () => {
        expect(modal).toContain('aigc:extract-job:')
        expect(modal).toContain('关闭弹窗不会停止后台任务')
        expect(modal).toContain('if (viewingExisting || jobId) return')
        expect(modal).toContain('else if (jobId) onJobIdChange?.(jobId)')
    })

    it('registers background extraction with Next.js and checkpoints every completed batch', () => {
        expect(route).toContain("import { after, NextRequest } from 'next/server'")
        expect(route).toMatch(/after\(\(\) =>\s*withHiModelsUsageScope\(\{ userId, jobId: job.id \}, async \(\) => \{/)
        expect(route).toContain('onChunkProgress: async (done, total, checkpoint)')
        expect(route).toContain('result: { ...checkpoint, chunkCount: total }')
        expect(route).toContain('resume:')
        expect(route).toContain('const heartbeat = setInterval')
        expect(route).toContain('clearInterval(heartbeat)')
    })

    it('expires interrupted workers quickly and lets the user resume from the checkpoint', () => {
        expect(store).toContain('const ACTIVE_JOB_STALE_MS = 6 * 60 * 1000')
        expect(store).toContain("phase: 'error'")
        expect(store).toContain('const interrupted = await tx.extractJob.findFirst')
        expect(store).toContain('resultCharacters: checkpoint?.resultCharacters')
        expect(modal).toContain('继续提取')
        expect(modal).toContain('checkpointAvailable')
        expect(modal).toContain('resumeFromJobId')
        expect(modal).toContain('restartExtraction')
    })

    it('releases stale and legacy terminal active keys before creating a replacement job', () => {
        expect(store).toContain("OR: [{ phase: 'error' }, { phase: 'done', committedAt: { not: null } }]")
        expect(store).toContain('data: { activeKey: null, leaseOwner: null, leaseExpiresAt: null }')
        expect(store).toContain('error: checkpointAvailable ? STALE_CHECKPOINT_JOB_ERROR : STALE_JOB_ERROR,\n                activeKey: null')
    })

    it('switches to merging status before merge work starts', () => {
        expect(route).toContain("onMergeStart: () => updateJob(job.id, { phase: 'merging' })")
        expect(modal).toContain("merging: '整理本次提取结果'")
        expect(modal).not.toContain("merging: '合并同名角色/场景'")
        expect(modal).toContain('旧角色、场景及参考图已清空，本次结果将全新入库。')
    })

    it('runs small groups concurrently but checkpoints only complete ordered groups', () => {
        expect(route).toContain('concurrency: 3')
        expect(llm).toContain('for (let groupStart = resumeChunksDone; groupStart < chunks.length; groupStart += concurrency)')
        expect(llm.indexOf('const results = await Promise.all(')).toBeLessThan(llm.indexOf('completed = groupEnd'))
        expect(llm.indexOf('completed = groupEnd')).toBeLessThan(llm.indexOf('await params.onChunkProgress?.(completed, chunks.length, buildCheckpoint())'))
    })
})
