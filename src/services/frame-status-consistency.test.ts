import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('storyboard frame status consistency', () => {
    it('uses actual illustration artifacts for button state and reconciles persisted status', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/episodes/[id]/route.ts'), 'utf8')
        expect(page).toContain('const frameReady = illustrations.length > 0')
        expect(page).toMatch(/:\s*frameReady\s*\?/)
        expect(page).toContain('disabled={batchBusy || !canGenerateVideo')
        expect(page).toContain("videoReferenceMode === 'first_last' && !referenceFramesReady")
        expect(route).toContain('staleFrameWithArtifactIds')
        expect(route).toContain("data: { frameStatus: 'completed' }")
    })

    it('does not repeat the completed illustration count in the generation step header', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        expect(page).toContain("const showFrameStepStatus = frameGenerating || submittingFrame || (sb.frameStatus !== 'completed' && !batchFrameReady)")
        expect(page).not.toContain('? `已生成 ${illustrations.length} 张`')
    })
})
