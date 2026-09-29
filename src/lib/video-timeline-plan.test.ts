import { describe, expect, it } from 'vitest'
import { buildSemanticVideoTimelineWindows, buildVideoTimelineInstructions, hasRequiredReferenceFrames, isCompleteVideoTimeline, minimumReferenceImageCount } from './video-timeline-plan'

describe('video timeline planning', () => {
    it('derives variable-duration fallback windows from storyboard semantics', () => {
        expect(buildSemanticVideoTimelineWindows({ duration: 6 }).map(window => window.label)).toEqual(['[0s-6s]'])
        expect(
            buildSemanticVideoTimelineWindows({
                duration: 6,
                actionDesc: 'Opening state: Lin grips the letter by the window; Ending state: she lowers it and turns toward the door'
            }).map(window => window.label)
        ).toEqual(['[0s-2.5s]', '[2.5s-6s]'])
        expect(
            buildSemanticVideoTimelineWindows({
                duration: 6,
                actionDesc: 'Opening state: Lin reads the letter; Middle state 1: her hand starts trembling; Ending state: she looks toward the door',
                dialogue: '林：他回来了。'
            }).map(window => window.label)
        ).toEqual(['[0s-1.5s]', '[1.5s-4s]', '[4s-6s]'])
    })

    it('requires distinct opening and ending frames for first-last generation', () => {
        expect(minimumReferenceImageCount('first_last')).toBe(2)
        expect(hasRequiredReferenceFrames('first_last', { firstFrameUrl: '/first.png' })).toBe(false)
        expect(hasRequiredReferenceFrames('first_last', { firstFrameUrl: '/same.png', plannedLastFrameUrl: '/same.png' })).toBe(false)
        expect(hasRequiredReferenceFrames('first_last', { firstFrameUrl: '/first.png', plannedLastFrameUrl: '/last.png' })).toBe(true)
    })

    it('makes camera and transition planning explicit for every provider', () => {
        const instructions = buildVideoTimelineInstructions({ duration: 4, provider: 'seedance25', referenceMode: 'first_last' })
        expect(instructions).toContain('Choose the number of segments and every boundary from the actual storyboard')
        expect(instructions).toContain('Do not default to a 0-2 second opening followed by one-second bins')
        expect(instructions).toContain('covers exactly 0s-4s')
        expect(instructions).toContain('SUBJECT ACTION')
        expect(instructions).toContain('CAMERA')
        expect(instructions).toContain('CONTINUITY/TRANSITION')
        expect(instructions).toContain('Image 1')
        expect(instructions).toContain('Image 2')

        const happyHorse = buildVideoTimelineInstructions({ duration: 4, provider: 'wanx', referenceMode: 'first_last' })
        expect(happyHorse).toContain('visual-only')
        expect(happyHorse).toContain('ordered visual anchors')

        const veo = buildVideoTimelineInstructions({ duration: 4, provider: 'veo3', referenceMode: 'text' })
        expect(veo).toContain('receives text only')
        expect(veo).toContain('restate the visible subject')

        const hiModelsSeedance = buildVideoTimelineInstructions({ duration: 4, provider: 'seedance-2.0-global', referenceMode: 'first_last' })
        expect(hiModelsSeedance).toContain('optional opening/ending references')
        expect(hiModelsSeedance).toContain('Image 1')
        expect(hiModelsSeedance).toContain('Image 2')
        expect(hiModelsSeedance).not.toContain('receives text only')

        const h3 = buildVideoTimelineInstructions({ duration: 15, provider: 'MiniMax-H3', referenceMode: 'first_last' })
        expect(h3).toContain('MiniMax H3 receives one prompt with optional image and video references')
        expect(h3).toContain('native multi-shot transitions')
        expect(h3).not.toContain('Himodels Seedance')
    })

    it('rejects incomplete or duplicated timelines', () => {
        const beat = (label: string) => `${label} SUBJECT ACTION: visible action. CAMERA: motivated framing. CONTINUITY/TRANSITION: continuous handoff.`
        expect(isCompleteVideoTimeline(`${beat('[0s-1.5s]')}\n${beat('[1.5s-4s]')}`, 4)).toBe(true)
        expect(isCompleteVideoTimeline(`${beat('[0s-1.5s]')}\n${beat('[2s-4s]')}`, 4)).toBe(false)
        expect(isCompleteVideoTimeline(`${beat('[0s-2s]')}\n${beat('[2s-3s]')}`, 4)).toBe(false)
        expect(isCompleteVideoTimeline('[0s-4s] SUBJECT ACTION: visible action. CAMERA: stable.', 4)).toBe(false)
        expect(isCompleteVideoTimeline('[0s-4s] SUBJECT ACTION: ; CAMERA: ; CONTINUITY/TRANSITION: .', 4)).toBe(false)
        expect(isCompleteVideoTimeline('[0s-4s] SUBJECT ACTION: hand lifts the letter; CAMERA: ; CONTINUITY/TRANSITION: letter stays in hand.', 4)).toBe(false)
    })
})
