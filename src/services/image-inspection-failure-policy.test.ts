import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('image inspection failure policy', () => {
    const ai = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
    const characterGeneration = ai.slice(ai.indexOf('export async function generateCharacterReference'), ai.indexOf('export async function generateSceneReference'))
    const sceneGeneration = ai.slice(ai.indexOf('export async function generateSceneReference'), ai.indexOf('// =================== 分镜视频生成'))
    const frameGeneration = ai.slice(ai.indexOf('export async function generateFrame'))

    it('does not run model inspection after generating scene references', () => {
        expect(sceneGeneration).not.toContain('inspectSceneReferenceQuality')
        expect(sceneGeneration).not.toContain("reportProgress('inspecting'")
    })

    it('does not run model inspection or automatic continuity repair after generating storyboard illustrations', () => {
        expect(frameGeneration).not.toContain('inspectVisualContinuity')
        expect(frameGeneration).not.toContain('inspectFrameReferenceConsistency')
        expect(frameGeneration).not.toContain('continuity_repair')
        expect(frameGeneration).not.toContain('qualityGateWarning')
    })

    it('keeps strict inspection for character reference assets only', () => {
        expect(characterGeneration).toContain('const qualityRejected =')
        expect(characterGeneration).toContain('inspectCharacterReferenceQuality')
    })
})
