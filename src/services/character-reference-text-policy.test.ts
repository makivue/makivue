import { describe, expect, it } from 'vitest'
import { shouldRejectCharacterReferenceImage, type ImageTextArtifactInspection } from './banana'

function inspection(patch: Partial<ImageTextArtifactInspection>): ImageTextArtifactInspection {
    return {
        hasText: false,
        hasWatermark: false,
        hasBlockingOverlay: false,
        confidence: 0.9,
        regions: [],
        blockingRegions: [],
        ...patch
    }
}

describe('character reference text policy', () => {
    it('allows nameplates, badges and armbands that belong to the costume', () => {
        expect(
            shouldRejectCharacterReferenceImage(
                inspection({
                    hasText: true,
                    hasWatermark: true,
                    hasBlockingOverlay: true,
                    regions: ['name tag on left chest', 'uniform badge', 'text on armband']
                })
            )
        ).toBe(false)
    })

    it('rejects overlaid captions and watermarks', () => {
        expect(
            shouldRejectCharacterReferenceImage(
                inspection({
                    hasText: true,
                    hasBlockingOverlay: true,
                    blockingRegions: ['caption in bottom margin']
                })
            )
        ).toBe(true)
        expect(shouldRejectCharacterReferenceImage(inspection({ hasWatermark: true }))).toBe(true)
    })

    it('rejects every visible glyph on a turnaround sheet', () => {
        expect(
            shouldRejectCharacterReferenceImage(
                inspection({
                    hasText: true,
                    hasBlockingOverlay: false,
                    regions: ['FRONT label above the first full-body view']
                }),
                { strictNoText: true }
            )
        ).toBe(true)
    })
})
