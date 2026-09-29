import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { defaultLocale, isLocale, localizePath } from '@/i18n/config'

export default async function Page() {
    const requestedLocale = (await headers()).get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale
    permanentRedirect(localizePath('/', locale))
}
