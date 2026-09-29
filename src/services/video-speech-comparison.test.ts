import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('video speech comparison architecture', () => {
    const aiSource = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'src/app/api/storyboards/[id]/compare-speech/route.ts'), 'utf8')

    it('keeps both comparison videos isolated from the storyboard main video', () => {
        expect(routeSource).toContain("type: COMPARISON_TYPE")
        expect(routeSource).toContain("provider: 'seedance'")
        expect(routeSource).toContain("provider: 'wanx'")
        expect(routeSource.match(/comparisonOnly: true/g)?.length).toBeGreaterThanOrEqual(2)
        expect(aiSource).toContain('if (comparisonOnly) return')
    })

    it('does not claim that HappyHorse has native dialogue audio', () => {
        expect(aiSource).toContain("generationMode = 'happyhorse_video'")
        expect(aiSource).not.toContain('happyhorse_native_audio')
        expect(aiSource).not.toContain('buildHappyHorseNativeAudioPrompt')
    })

    it('uses native Seedance audio and a Happy Horse visual-only comparison', () => {
        expect(aiSource).toContain("referenceMode === 'first_last' && !localizedStoryboard.dialogue?.trim()")
        expect(routeSource).not.toContain('generateAudio')
        expect(routeSource).not.toContain('DIALOGUE_SPLIT_REQUIRED')
        expect(routeSource).not.toContain('driving_audio')
    })
})
