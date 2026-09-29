import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStoryboardGenerationRequest, resolveStoryboardGenerationMode } from './storyboard-generation-request'

describe('storyboard generation request', () => {
    it('sends explicit and legacy overwrite signals for rolling-deployment compatibility', () => {
        expect(buildStoryboardGenerationRequest({ episodeId: '12', mode: 'overwrite' })).toEqual({
            episodeId: '12',
            generationMode: 'overwrite',
            overwriteExisting: true
        })
    })

    it('never grants overwrite permission in missing mode', () => {
        expect(buildStoryboardGenerationRequest({ episodeId: '12', mode: 'missing' })).toEqual({
            episodeId: '12',
            generationMode: 'missing',
            overwriteExisting: false
        })
    })

    it('accepts legacy clients but rejects contradictory mode signals', () => {
        expect(resolveStoryboardGenerationMode(undefined, true)).toBe('overwrite')
        expect(resolveStoryboardGenerationMode(undefined, false)).toBe('missing')
        expect(resolveStoryboardGenerationMode('overwrite', true)).toBe('overwrite')
        expect(resolveStoryboardGenerationMode('missing', false)).toBe('missing')
        expect(resolveStoryboardGenerationMode('overwrite', false)).toBeNull()
        expect(resolveStoryboardGenerationMode('missing', true)).toBeNull()
        expect(resolveStoryboardGenerationMode('unknown', undefined)).toBeNull()
    })

    it('keeps every UI entry point and the API on the shared request contract', () => {
        const episodePage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        const novelTab = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/NovelTab.tsx'), 'utf8')
        const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/storyboard/route.ts'), 'utf8')

        expect(episodePage.match(/buildStoryboardGenerationRequest\(/g)).toHaveLength(2)
        expect(episodePage).toContain("mode: mode === 'all' ? 'overwrite' : 'missing'")
        expect(novelTab).toContain("mode: existingCount > 0 ? 'overwrite' : 'missing'")
        expect(novelTab).not.toContain('targetShotCount')
        expect(novelTab).not.toContain('目标镜头数')
        expect(route).toContain('resolveStoryboardGenerationMode(rawGenerationMode, rawOverwriteExisting)')
    })
})
