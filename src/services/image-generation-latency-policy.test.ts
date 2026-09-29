import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('image generation latency policy', () => {
    const root = process.cwd()
    const llm = fs.readFileSync(path.join(root, 'src/services/llm.ts'), 'utf8')
    const banana = fs.readFileSync(path.join(root, 'src/services/banana.ts'), 'utf8')
    const batchRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')

    it('keeps optional frame prompt polishing out of the critical path', () => {
        const improveFramePrompt = llm.slice(llm.indexOf('export async function improveFrameImagePrompt'), llm.indexOf('export async function rewriteImagePromptForSafety'))
        expect(improveFramePrompt).toContain('timeoutMs: 12_000')
        expect(improveFramePrompt).toContain('attempts: 1')
        expect(improveFramePrompt).toContain('return params.basePrompt')
    })

    it('loads independent Nano Banana references concurrently with a bounded timeout', () => {
        expect(banana).toContain('fetchTimeoutSignal(20_000, signal)')
        expect(banana).toContain('const loadedReferences = await Promise.all(')
        expect(banana).toContain('refs.map(async refSrc =>')
    })

    it('does not block one-click video generation on optional keyframes', () => {
        expect(batchRoute).toContain('const illustrationCount = shouldGenerateIllustrations ? 1 : 0')
        expect(batchRoute).not.toContain("generateFrame(genMiddle.id, shotFullMiddle, 'middle_frame'")
        expect(batchRoute).not.toContain("generateFrame(genLast.id, shotFullLast, 'last_frame'")
    })

    it('keeps only one shot active so the next image can use the completed video tail', () => {
        expect(batchRoute).toContain('const frameReady = await generateStoryboardFrame(sb)')
        expect(batchRoute).toContain('const videoReady = await generateStoryboardVideo(sb)')
        expect(batchRoute).not.toContain('await Promise.all(taskByStoryboardId.values())')
        expect(batchRoute).not.toContain('createConcurrencyLimiter')
    })
})
