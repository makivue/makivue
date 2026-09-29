import { describe, expect, it } from 'vitest'
import { resolveImageProviderForReferences } from './ai'
import { quoteGenerationPoints } from './billing'

describe('image provider reference routing', () => {
    it('keeps providers that support references and reroutes text-only Seedream 5', () => {
        expect(resolveImageProviderForReferences('banana', 2)).toBe('banana')
        expect(resolveImageProviderForReferences('doubao', 2)).toBe('banana')
        expect(resolveImageProviderForReferences('qwen-image-3.0-pro', 2)).toBe('qwen-image-3.0-pro')
    })

    it('quotes the provider that can actually consume the input references', () => {
        for (const provider of ['doubao', 'seedream-5-0-lite'] as const) {
            expect(quoteGenerationPoints('reference', resolveImageProviderForReferences(provider, 0))).toBe(40)
            expect(quoteGenerationPoints('reference', resolveImageProviderForReferences(provider, 1))).toBe(5)
        }
    })
})
