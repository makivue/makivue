import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('character story-state flow', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
    const projectRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/projects/[id]/route.ts'), 'utf8')
    const characterReferenceRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/characters/[id]/reference/route.ts'), 'utf8')
    const ai = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
    const llm = fs.readFileSync(path.join(process.cwd(), 'src/services/llm.ts'), 'utf8')

    it('does not expose or automatically generate a visual-state ledger', () => {
        expect(page).not.toContain('analyzeCharacterStateLedger')
        expect(page).not.toContain('generateMissingCharacterStateRefs')
        expect(page).not.toMatch(/剧情形象台账/)
        expect(page).not.toContain("role: 'state'")
        expect(fs.existsSync(path.join(process.cwd(), 'src/app/api/projects/[id]/character-states/route.ts'))).toBe(false)
        expect(characterReferenceRoute).not.toContain("role === 'state'")
        expect(llm).not.toContain('visualStates')
        expect(llm).not.toContain('extractCharacterVisualStateLedgers')
    })

    it('returns only the primary turnaround sheet to the character page', () => {
        expect(projectRoute).toContain("role: 'full_body'")
        expect(projectRoute).toContain('omit: { stateTimeline: true }')
        expect(projectRoute).not.toContain("role: 'state_reference'")
    })

    it('keeps story state as prompt text without using a pose or expression image', () => {
        expect(ai).not.toContain('CURRENT TIMELINE STATE:')
        expect(ai).toContain('character.referenceImageUrl')
        expect(ai).not.toContain('identitySupplementUrl')
        expect(ai).not.toContain('currentState?.assetUrl ?? identityUrl')
    })
})
