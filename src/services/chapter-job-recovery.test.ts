import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chapter job start recovery', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/chapter/route.ts'), 'utf8')
    const client = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/NovelTab.tsx'), 'utf8')

    it('reuses an active episode job before creating a new one', () => {
        expect(route).toContain("phase: { in: ['generating', 'writing_db'] }")
        expect(route.indexOf('const activeJob =')).toBeLessThan(route.indexOf('const job = await createJob('))
        expect(route).toContain('resumed: true')
    })

    it('registers chapter generation with the Next.js lifecycle', () => {
        expect(route).toContain('after(() => withHiModelsUsageScope({ userId, jobId: job.id, onUsage: usage.onTokenUsage }, () => runChapterJob(')
        expect(route).not.toContain('void runChapterJob(')
    })

    it('uses the shared recovery client for individual and batch chapters', () => {
        expect(client).toContain("import { pollChapterJob, startChapterJob } from '@/lib/chapter-generation-client'")
        expect(client.match(/await startChapterJob\(/g)).toHaveLength(2)
    })

    it('keeps the paused notice and a single resume action if automatic recovery is exhausted', () => {
        expect(client).toContain('顺序生成已暂停')
        expect(client).toContain('继续生成剩余章节')
        expect(client).toContain('请使用顶部按钮继续生成。')
        expect(client.match(/void batchGenerate\('missing'\)/g)).toHaveLength(1)
    })
})
