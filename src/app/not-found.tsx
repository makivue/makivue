import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { defaultLocale, isLocale, localizePath } from '@/i18n/config'

export default async function NotFound() {
    const requestHeaders = await headers()
    const requestedLocale = requestHeaders.get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale
    redirect(localizePath('/', locale))
}
