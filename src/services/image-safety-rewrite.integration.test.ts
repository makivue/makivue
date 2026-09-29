import { describe, expect, it } from 'vitest'
import { rewriteImagePromptForSafety } from './llm'

describe.skipIf(process.env.RUN_LLM_INTEGRATION !== '1')('image safety rewrite integration', () => {
    it('rewrites through the configured text model without coupling to the image provider', async () => {
        const rewritten = await rewriteImagePromptForSafety({
            prompt: 'cinematic fantasy palace, adult queen protecting her father after an off-screen attack, tense atmosphere, torn royal banners, no visible injury, no text, no watermark',
            attempt: 1
        })
        expect(rewritten.length).toBeGreaterThan(40)
    }, 120_000)
})
