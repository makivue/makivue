import { describe, expect, it } from 'vitest'
import { locales } from '@/i18n/config'
import { countryDisplayName, SUPPORTED_COUNTRIES } from './country-config'

describe('localized payment country names', () => {
    it.each(locales)('provides a display name for every supported country in %s', locale => {
        const original = JSON.stringify(SUPPORTED_COUNTRIES)
        for (const code of Object.keys(SUPPORTED_COUNTRIES)) {
            expect(countryDisplayName(code, locale).trim()).not.toBe('')
            expect(countryDisplayName(code, locale)).not.toBe(code)
        }
        expect(JSON.stringify(SUPPORTED_COUNTRIES)).toBe(original)
    })

    it('uses the UI language without changing country codes or currencies', () => {
        expect(countryDisplayName('US', 'en')).toBe('United States')
        expect(countryDisplayName('US', 'zh')).toBe('美国')
        expect(countryDisplayName('US', 'fr')).toBe('États-Unis')
        expect(countryDisplayName('US', 'ja')).toBe('アメリカ合衆国')
        expect(SUPPORTED_COUNTRIES.US.currency).toBe('USD')
        expect(countryDisplayName('invalid', 'en')).toBe('invalid')
    })
})
