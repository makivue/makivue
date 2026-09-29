import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode batch user messaging', () => {
    const root = process.cwd()
    const modal = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx'), 'utf8')
    const route = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')

    it('does not expose the selected video model in the progress modal', () => {
        expect(modal).not.toMatch(/\u{672c}\u{6b21}\u{4e00}\u{952e}\u{751f}\u{6210}\u{4f7f}\u{7528}\u{9876}\u{90e8}\u{9009}\u{62e9}\u{7684}\u{89c6}\u{9891}\u{6a21}\u{578b}/u)
    })

    it('keeps optional middle illustrations out of the one-click critical path', () => {
        expect(route).not.toContain('keyframeDialogueConflicts')
        expect(route).not.toContain('recommendMiddleFrameCount')
        expect(route).toContain('const illustrationCount = shouldGenerateIllustrations ? 1 : 0')
    })
})
