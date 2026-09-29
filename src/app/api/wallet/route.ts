import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse, handleApiError } from '@/lib/utils'
import { getWalletSnapshot } from '@/services/billing'
import { detectUserCountry } from '@/lib/user-country'
import { isLocale } from '@/i18n/config'
import { tryDailyFxSync } from '@/services/fx-rates'
import { isValidCountry, countryConfig } from '@/lib/country-config'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录后查看账户余额', 401)
    try {
        tryDailyFxSync().catch(() => {})
        const locale = isLocale(req.headers.get('x-app-locale')) ? req.headers.get('x-app-locale')! : 'en'
        const rawCountry = req.headers.get('x-app-country')
        console.log('[wallet] x-app-country=%s isValid=%s', rawCountry, isValidCountry(rawCountry))
        const countryCode = await detectUserCountry(userId, locale, req.headers)
        console.log('[wallet] detected=%s config=%j', countryCode, countryConfig(countryCode))
        return apiResponse(await getWalletSnapshot(userId, countryCode))
    } catch (error) {
        console.error('[wallet] failed to load wallet', error)
        return handleApiError(error, '账户余额加载失败')
    }
}
