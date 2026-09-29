import { defaultCountryForLocale, isValidCountry } from '@/lib/country-config'

export async function detectUserCountry(_userId: bigint | null, locale: string, requestHeaders?: Headers): Promise<string> {
    const selected = requestHeaders?.get('x-app-country')
    return selected && isValidCountry(selected) ? selected : defaultCountryForLocale(locale)
}
