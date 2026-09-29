// 国家/币种/语言统一配置 — 单一数据源
export type CountryConfig = {
    currency: string
    currencySymbol: string
    name: string
}

export type LocaleCountryConfig = {
    label: string
    country: string
    currency: string
    currencySymbol: string
    countryName: string
}

// 所有 locale → country → currency 链
export const LOCALE_COUNTRY = {
    en: { label: 'English', country: 'US', currency: 'USD', currencySymbol: '$', countryName: 'United States' },
    zh: { label: '中文', country: 'MY', currency: 'MYR', currencySymbol: 'RM', countryName: 'Malaysia' },
    fr: { label: 'Français', country: 'TR', currency: 'TRY', currencySymbol: '₺', countryName: 'Turkey' },
    ar: { label: 'العربية', country: 'SA', currency: 'SAR', currencySymbol: '﷼', countryName: 'Saudi Arabia' },
    id: { label: 'Bahasa Indonesia', country: 'ID', currency: 'IDR', currencySymbol: 'Rp', countryName: 'Indonesia' },
    hi: { label: 'हिन्दी', country: 'IN', currency: 'INR', currencySymbol: '₹', countryName: 'India' },
    fil: { label: 'Filipino', country: 'PH', currency: 'PHP', currencySymbol: '₱', countryName: 'Philippines' },
    ja: { label: '日本語', country: 'KR', currency: 'KRW', currencySymbol: '₩', countryName: 'South Korea' },
    ko: { label: '한국어', country: 'KR', currency: 'KRW', currencySymbol: '₩', countryName: 'South Korea' }
} as const satisfies Record<string, LocaleCountryConfig>

export const DEFAULT_LOCALE = 'en'

// 支持的国家与地区（供用户手动选择）
export const SUPPORTED_COUNTRIES: Record<string, CountryConfig> = {
    NG: { currency: 'NGN', currencySymbol: '₦', name: 'Nigeria' },
    KE: { currency: 'KES', currencySymbol: 'KSh', name: 'Kenya' },
    GH: { currency: 'GHS', currencySymbol: '₵', name: 'Ghana' },
    UG: { currency: 'UGX', currencySymbol: 'USh', name: 'Uganda' },
    TZ: { currency: 'TZS', currencySymbol: 'TSh', name: 'Tanzania' },
    EG: { currency: 'EGP', currencySymbol: 'E£', name: 'Egypt' },
    AE: { currency: 'AED', currencySymbol: 'د.إ', name: 'UAE' },
    BH: { currency: 'BHD', currencySymbol: 'BD', name: 'Bahrain' },
    JO: { currency: 'JOD', currencySymbol: 'JD', name: 'Jordan' },
    KW: { currency: 'KWD', currencySymbol: 'KD', name: 'Kuwait' },
    OM: { currency: 'OMR', currencySymbol: 'RO', name: 'Oman' },
    QA: { currency: 'QAR', currencySymbol: 'QR', name: 'Qatar' },
    SA: { currency: 'SAR', currencySymbol: '﷼', name: 'Saudi Arabia' },
    TR: { currency: 'TRY', currencySymbol: '₺', name: 'Turkey' },
    PK: { currency: 'PKR', currencySymbol: 'Rs', name: 'Pakistan' },
    BD: { currency: 'BDT', currencySymbol: '৳', name: 'Bangladesh' },
    ID: { currency: 'IDR', currencySymbol: 'Rp', name: 'Indonesia' },
    TH: { currency: 'THB', currencySymbol: '฿', name: 'Thailand' },
    PH: { currency: 'PHP', currencySymbol: '₱', name: 'Philippines' },
    MY: { currency: 'MYR', currencySymbol: 'RM', name: 'Malaysia' },
    VN: { currency: 'VND', currencySymbol: '₫', name: 'Vietnam' },
    KR: { currency: 'KRW', currencySymbol: '₩', name: 'South Korea' },
    IN: { currency: 'INR', currencySymbol: '₹', name: 'India' },
    US: { currency: 'USD', currencySymbol: '$', name: 'United States' },
    RU: { currency: 'RUB', currencySymbol: '₽', name: 'Russia' }
}

export function isValidCountry(code: string | null | undefined): boolean {
    return !!code && Object.hasOwn(SUPPORTED_COUNTRIES, code)
}

export function countryConfig(code: string): CountryConfig | undefined {
    return isValidCountry(code) ? SUPPORTED_COUNTRIES[code] : undefined
}

export function countryDisplayName(code: string, locale: string): string {
    const country = countryConfig(code)
    if (!country) return code
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? country.name
}

export function defaultCountryForLocale(locale: string): string {
    return LOCALE_COUNTRY[locale as keyof typeof LOCALE_COUNTRY]?.country ?? 'US'
}
