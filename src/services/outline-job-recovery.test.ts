import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRecoverableOutlineJob, OUTLINE_JOB_STALE_MS } from '@/lib/outlineJobStore'

describe('outline job recovery', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/outline/route.ts'), 'utf8')
    const statusRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/outline/status/[jobId]/route.ts'), 'utf8')
    const novelTab = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/NovelTab.tsx'), 'utf8')
    const llm = fs.readFileSync(path.join(process.cwd(), 'src/services/llm.ts'), 'utf8')
    const store = fs.readFileSync(path.join(process.cwd(), 'src/lib/outlineJobStore.ts'), 'utf8')

    it('expires a worker that has stopped heartbeating within a few minutes', () => {
        expect(OUTLINE_JOB_STALE_MS).toBe(3 * 60 * 1000)
        expect(statusRoute).toContain('recoverable: isRecoverableOutlineJob(job)')
        expect(
            isRecoverableOutlineJob({
                phase: 'error',
                error: '任务租约过期，已自动回收，请重试',
                receivedChapters: 5,
                totalEpisodes: 30
            })
        ).toBe(true)
        expect(
            isRecoverableOutlineJob({
                phase: 'error',
                error: '服务重启后任务租约已过期，请重试',
                receivedChapters: 5,
                totalEpisodes: 30
            })
        ).toBe(true)
    })

    it('keeps the lease alive while a provider request is running', () => {
        expect(route.match(/const heartbeat = setInterval/g)).toHaveLength(2)
        expect(route.match(/clearInterval\(heartbeat\)/g)).toHaveLength(2)
        expect(route).toContain('void updateJob(jobId, {})')
    })

    it('stops superseded workers before they can overwrite a recovered job', () => {
        expect(route).toContain('await assertJobActive(jobId)')
    })

    it('restores polling after refresh and continues from persisted chapters', () => {
        expect(route).toContain('export async function GET(req: NextRequest)')
        expect(store).toContain('const checked = await getJob(row.id.toString())')
        expect(novelTab).toContain('aigc:outline-job:')
        expect(novelTab).toContain('body: JSON.stringify({ projectId, continueMissing: true })')
        expect(novelTab).toContain('data.recoverable === true')
    })

    it('supports owner-initiated cancellation and stops client polling immediately', () => {
        expect(statusRoute).toContain('export async function DELETE')
        expect(store).toContain('export async function cancelJob')
        expect(novelTab).toContain('outlinePollAbortRef.current?.abort()')
        expect(novelTab).toContain("method: 'DELETE'")
        expect(novelTab).toContain("data.phase === 'cancelled'")
    })

    it('does not start duplicate workers for concurrent continue requests', () => {
        expect(route).toContain('if (job.createdByRequest)')
        expect(route).toContain('resumed: !job.createdByRequest')
    })

    it('bounds each provider attempt instead of silently waiting for the global ten-minute retry policy', () => {
        expect(llm.match(/timeoutMs: 180_000, attempts: 1/g)).toHaveLength(2)
    })
})
