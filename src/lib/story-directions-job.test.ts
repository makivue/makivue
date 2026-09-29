import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isStoryDirectionsJobStale, STORY_DIRECTIONS_STALE_MS } from './story-directions-job'

describe('story directions job lifecycle', () => {
    const now = Date.parse('2026-07-25T10:00:00.000Z')

    it('keeps a recently updated job active', () => {
        expect(isStoryDirectionsJobStale(now - STORY_DIRECTIONS_STALE_MS + 1, now)).toBe(false)
    })

    it('marks an interrupted job stale at the deadline', () => {
        expect(isStoryDirectionsJobStale(now - STORY_DIRECTIONS_STALE_MS, now)).toBe(true)
    })

    it('registers generation with the Next.js request lifecycle', () => {
        const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/story-directions/route.ts'), 'utf8')
        expect(route).toContain("import { after, NextRequest } from 'next/server'")
        expect(route).toContain('after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runStoryDirectionsJob(')
        expect(route).not.toContain('void runStoryDirectionsJob(')
    })
})
