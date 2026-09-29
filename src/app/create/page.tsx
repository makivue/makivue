import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { defaultLocale, isLocale, localizePath } from '@/i18n/config'

export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const requestedLocale = (await headers()).get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale
    const params = await searchParams
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) value.forEach(item => query.append(key, item))
        else if (value !== undefined) query.set(key, value)
    }
    const suffix = query.size ? `?${query}` : ''
    redirect(localizePath(`/aivideo${suffix}`, locale))
}
