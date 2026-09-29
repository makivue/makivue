import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('shot continuity architecture', () => {
    it('chains validated story-state and pixel-continuous shots to the previous planned ending frame', () => {
        const route = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
        expect(route).toContain("referenceMode: shot.plannedLastFrameUrl ? 'first_last' : 'single'")
        expect(route).not.toContain("getHiModelsVideoApiModel(shotVideoProvider) ? 'text'")
        expect(route).toContain("generateFrame(gen1.id, sb, 'first_frame'")
        expect(route).toContain("storyboard.continuityMode !== 'stateful'")
        expect(route).toContain("previous.videoStatus === 'completed'")
        expect(route).toContain('previous.actualVideoEndFrameUrl')
        expect(route).toContain('缺少上一镜成功视频的真实尾帧，已阻断生成')
        expect(route).not.toContain('const plannedEndingFrameUrl = previous?.plannedLastFrameUrl')
        expect(route).toContain('assessPreviousEndingFrameAnchor')
        expect(route).toContain('assessSequentialContinuityDependency')
        expect(route).toContain('previousSucceeded === false')
        expect(route).toContain('previousShotFrameUrl: previousShotAnchor.url')
    })

    it('retains same-shot anchors while keeping cross-shot chaining explicit', () => {
        const service = fs.readFileSync(path.join(root, 'src/services/ai.ts'), 'utf8')
        expect(service).toContain("const ownFirstFrame = type !== 'first_frame' ?")
        expect(service).toContain('FRAME CONTINUITY LOCK')
        expect(service).toContain('PREVIOUS SHOT CONTINUITY LOCK')
        expect(service).toContain('PREVIOUS SHOT STORY-STATE LOCK')
        expect(service).toContain('CANONICAL IDENTITY RE-ANCHOR')
        expect(service).toContain('IDENTITY LOCK')
        expect(service).not.toContain('CONTINUITY OPEN: this is the OPENING frame of a NEW shot')
    })
})
