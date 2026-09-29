import { describe, expect, it } from 'vitest'
import { isBananaImageSafetyResponse } from './banana'

describe('Nano Banana image safety response detection', () => {
    it('detects promptFeedback SAFETY blocks without candidates', () => {
        expect(
            isBananaImageSafetyResponse({
                promptFeedback: {
                    blockReason: 'SAFETY',
                    blockReasonMessage: 'The prompt is blocked due to safety'
                },
                usageMetadata: { promptTokenCount: 388 }
            })
        ).toBe(true)
    })

    it.each(['IMAGE_SAFETY', 'SAFETY', 'NO_IMAGE', 'PROHIBITED_CONTENT'])(
        'detects candidate finish reason %s',
        finishReason => {
            expect(isBananaImageSafetyResponse({ candidates: [{ finishReason }] })).toBe(true)
        }
    )

    it('treats promptFeedback OTHER without candidates as a recoverable generation block', () => {
        expect(
            isBananaImageSafetyResponse({
                promptFeedback: { blockReason: 'OTHER' },
                usageMetadata: { trafficType: 'ON_DEMAND' },
                modelVersion: 'gemini-3.1-flash-image'
            })
        ).toBe(true)
    })

    it('does not treat an ordinary empty response as a safety block', () => {
        expect(isBananaImageSafetyResponse({ usageMetadata: { promptTokenCount: 12 } })).toBe(false)
    })
})
