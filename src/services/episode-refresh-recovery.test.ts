import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode automatic refresh recovery', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('does not present automatic request cancellation as a user-facing failure', () => {
        expect(page).toContain("if (isRequestAbortError(err)) return 'transient-error' as const")
        expect(page.indexOf('isRequestAbortError(err)')).toBeLessThan(page.indexOf("setAiMsg({ type: 'error', text: `页面数据刷新失败：${msg}` })"))
        expect(page).toContain('if (isRequestAbortError(err)) {')
        expect(page.indexOf('if (isRequestAbortError(err)) {')).toBeLessThan(page.indexOf("setAiMsg({ type: 'error', text: `项目数据加载失败：${msg}` })"))
    })

    it('retries transient refresh cancellation without replacing durable task state', () => {
        expect(page).toContain("result !== 'transient-error'")
        expect(page).toContain('await refreshEpisodeProgress()')
        expect(page).toContain('failureCount: failures, jitterRatio: 0.15')
        expect(page).toContain('Date.now() - episodeStatusDetailAt.current >= 120_000')
    })
})
