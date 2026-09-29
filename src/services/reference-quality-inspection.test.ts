import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { normalizedReferenceQualityScore, parseReferenceQualityInspectionJson, referenceInspectionMaxOutputTokens } from './banana'

const requiredCharacterFields = ['score', 'singleCharacter', 'faceVisible', 'fullBodyVisible', 'identityReady', 'issues']
describe('reference quality inspection JSON parsing', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/banana.ts'), 'utf8')

    it('accepts a complete structured character inspection', () => {
        expect(
            parseReferenceQualityInspectionJson('{"score":88,"singleCharacter":true,"faceVisible":true,"fullBodyVisible":true,"identityReady":true,"issues":[]}', requiredCharacterFields)
        ).toMatchObject({ score: 88, identityReady: true })
    })

    it('repairs harmless JSON formatting defects', () => {
        expect(
            parseReferenceQualityInspectionJson(
                '```json\n{"score":88,"singleCharacter":true,"faceVisible":true,"fullBodyVisible":true,"identityReady":true,"issues":[],}\n```',
                requiredCharacterFields
            )
        ).toMatchObject({ score: 88, singleCharacter: true })
    })

    it('rejects a truncated response with missing quality gates so the request can be retried', () => {
        expect(parseReferenceQualityInspectionJson('{\n  "score": 0.3', requiredCharacterFields)).toBeNull()
    })

    it('reserves reasoning-token headroom for Gemini vision inspectors', () => {
        expect(referenceInspectionMaxOutputTokens('gemini-2.5-pro', 0)).toBe(18432)
        expect(referenceInspectionMaxOutputTokens('gemini-2.5-pro', 1)).toBe(32768)
        expect(referenceInspectionMaxOutputTokens('gemini-2.0-flash', 0)).toBe(2048)
    })

    it('uses structured output with configurable retries for prompt-image inspection', () => {
        expect(source).toContain('async function inspectImageSetJson')
        expect(source).toContain('const maxAttempts = Math.max(1, params.maxAttempts ?? 3)')
        expect(source).toContain('for (let attempt = 0; attempt < maxAttempts; attempt += 1)')
        expect(source).toContain('responseSchema: params.schema')
        expect(source).toContain("errorLabel: 'Reference prompt inspection'")
    })

    it('limits prompt image diagnosis to one bounded attempt', () => {
        const promptInspector = source.slice(source.indexOf('export async function inspectReferencePromptImage'), source.indexOf('export type CharacterReferenceQualityInspection'))
        expect(promptInspector).toContain('maxAttempts: 1')
        expect(promptInspector).toContain('timeoutMs: 20_000')
    })

    it('normalizes inspector-native 0-1 and 0-10 scores to the requested 0-100 scale', () => {
        expect(normalizedReferenceQualityScore(0.82)).toBe(82)
        expect(normalizedReferenceQualityScore('0.7')).toBe(70)
        expect(normalizedReferenceQualityScore(1)).toBe(100)
        expect(normalizedReferenceQualityScore(7)).toBe(70)
        expect(normalizedReferenceQualityScore(10)).toBe(100)
        expect(normalizedReferenceQualityScore(88)).toBe(88)
    })

    it('accepts a visibly usable profile without demanding mathematically exact 90 degrees', () => {
        expect(source).toContain('Set angleMatch=true for a visibly usable side profile even if it is a few degrees off exact 90')
        expect(source).toContain('Do not reject a usable profile solely because mathematical exactness cannot be measured from pixels')
        expect(source).toContain('set it false for an obvious three-quarter or frontal view')
    })
})
