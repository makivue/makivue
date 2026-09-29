import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Seedance 2.5 generation-time prompt compilation', () => {
    it('compiles only Seedance 2.5 requests at generation time', () => {
        const ai = source('src/services/ai.ts')
        expect(ai).toContain("if (provider !== 'seedance25') return [motionBody, ...hardLocks]")
        expect(ai).toContain('return compileSeedance25Prompt({')
        expect(ai).toContain('provider,')
        expect(ai).toContain('referenceMode')
        expect(ai).toContain('timelinePlanVersion: VIDEO_TIMELINE_PLAN_VERSION')
        expect(ai).toContain("promptCompiler: provider === 'seedance25' ? SEEDANCE_25_PROMPT_COMPILER_VERSION : 'default'")
    })

    it('maps the actual opening, ending, style and character image order into responsibilities', () => {
        const ai = source('src/services/ai.ts')
        expect(ai).toContain("referenceAssets.push({ index: 1, purpose: 'opening_frame' })")
        expect(ai).toContain("referenceAssets.push({ index: 2, purpose: 'ending_frame' })")
        expect(ai).toContain("purpose: 'visual_style'")
        expect(ai).toContain("purpose: 'character_turnaround'")
        expect(ai).toContain('referenceAssets')
        expect(ai).toContain('CHARACTER TURNAROUND REFERENCE RULE')
    })

    it('keeps the saved storyboard as source data and sends the compiled prompt only in the provider request', () => {
        const ai = source('src/services/ai.ts')
        expect(ai).toContain("const content: Array<Record<string, unknown>> = [{ type: 'text', text }, ...imageContent, ...videoContent]")
        expect(ai).not.toContain('fullPromptOverride: text')
        expect(ai).not.toContain('videoPrompt: text')
    })
})
