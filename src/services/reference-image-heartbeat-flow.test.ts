import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('reference image heartbeat flow', () => {
    const characterRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/characters/[id]/reference/route.ts'), 'utf8')
    const characterJob = fs.readFileSync(path.join(process.cwd(), 'src/services/character-reference-job.ts'), 'utf8')
    const sceneJob = fs.readFileSync(path.join(process.cwd(), 'src/services/scene-reference-job.ts'), 'utf8')
    const projectPage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/page.tsx'), 'utf8')

    it.each([
        ['character', characterJob],
        ['scene', sceneJob]
    ])('keeps the %s job heartbeat referenced until the job finishes', (_name, route) => {
        expect(route).toContain('const heartbeat = setInterval')
        expect(route).toContain('clearInterval(heartbeat)')
        expect(route).toContain('isRefImageJobRuntimeExceeded(startedAt)')
        expect(route).toContain('referenceProgressAt(latestProgress, startedAt)')
        expect(route).not.toContain('heartbeat.unref()')
    })

    it('routes character requests through the shared queued job runner', () => {
        expect(characterRoute).toContain('runQueuedCharacterReferenceJob({')
    })

    it('stops client polling when persisted progress has not changed for two minutes', () => {
        expect(projectPage).toContain('activitySignature !== lastActivitySignature')
        expect(projectPage).toContain('Date.now() - lastActivityAt >= REF_IMAGE_STALE_WINDOW_MS')
        expect(projectPage).toContain('图片任务超过 2 分钟没有心跳，已自动回收，请重试')
    })

    it('keeps polling when the status endpoint has a temporary gateway failure', () => {
        expect(projectPage).toContain('[429, 502, 503, 504].includes(res.status)')
        expect(projectPage).toContain('lastPollingError = message')
    })
})
