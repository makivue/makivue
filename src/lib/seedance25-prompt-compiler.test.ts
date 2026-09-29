import { describe, expect, it } from 'vitest'
import { compileSeedance25Prompt, SEEDANCE_25_PROMPT_COMPILER_VERSION } from './seedance25-prompt-compiler'

describe('Seedance 2.5 prompt compiler', () => {
    it('organizes storyboard facts and actual reference responsibilities using the guide structure', () => {
        const prompt = compileSeedance25Prompt({
            duration: 30,
            generationGoal: 'A fighter blocks one punch and forces the opponent back.',
            motionPlan: 'The opponent throws one punch. Lin fixes her gaze on his shoulder, blocks, exhales sharply and shifts her weight forward.',
            characters: ['Lin: short black hair, dark training clothes', 'Chen: red gloves'],
            scene: 'A quiet training room',
            visualStyle: 'cinematic realism',
            shotType: 'medium',
            referenceAssets: [
                { index: 2, purpose: 'ending_frame' },
                { index: 1, purpose: 'opening_frame' }
            ],
            audioDirection: 'Lin says exactly: "Again."',
            languageDirection: 'Spoken language is Mandarin Chinese.',
            immutableConstraints: ['Keep both identities and wardrobe unchanged.']
        })

        expect(SEEDANCE_25_PROMPT_COMPILER_VERSION).toBe('seedance25-guide-v3')
        expect(prompt).toContain('[REFERENCE RESPONSIBILITIES]')
        expect(prompt.indexOf('Image 1 is the opening frame')).toBeLessThan(prompt.indexOf('Image 2 is the ending frame'))
        expect(prompt).toContain('[EVENT AND OBSERVABLE PERFORMANCE]')
        expect(prompt).toContain('[ENDING STATE]')
        expect(prompt).toContain('settle naturally into Image 2')
        expect(prompt).toContain('[AUDIO]')
    })

    it('uses a turnaround sheet as identity geometry without copying its layout into video', () => {
        const prompt = compileSeedance25Prompt({
            duration: 8,
            generationGoal: 'The mage turns toward camera.',
            motionPlan: 'The mage turns once and raises one hand.',
            characters: ['The mage: weathered face and brown cloak'],
            visualStyle: 'cinematic realism',
            shotType: 'medium',
            referenceAssets: [{ index: 1, purpose: 'character_turnaround', subject: 'the mage' }],
            immutableConstraints: ['Keep identity unchanged.']
        })

        expect(prompt).toContain('multi-view turnaround sheet')
        expect(prompt).toContain('render that character only once')
        expect(prompt).toContain('Never reproduce the sheet')
    })

    it('does not invent references for a text-only request', () => {
        const prompt = compileSeedance25Prompt({
            duration: 8,
            generationGoal: 'Clouds move over an empty garden.',
            motionPlan: 'Wind bends the flowers before the sunlight returns.',
            characters: [],
            visualStyle: 'painted animation',
            shotType: 'wide',
            immutableConstraints: ['Keep visible character count zero.']
        })
        expect(prompt).not.toContain('[REFERENCE RESPONSIBILITIES]')
        expect(prompt).toContain('No person or humanoid appears')
    })
})
