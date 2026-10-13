import { permanentRedirect } from 'next/navigation'
import { headers } from 'next/headers'
import { defaultLocale, isLocale, localizePath } from '@/i18n/config'

export default async function KnowledgeRedirectPage() {
    const value = (await headers()).get('x-app-locale')
    permanentRedirect(localizePath('/how-to-use', isLocale(value) ? value : defaultLocale))
}
