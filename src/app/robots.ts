import type { MetadataRoute } from 'next'
import { localizedLocales } from '@/i18n/config'
import { getSiteUrl } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
    const privateRoutes = ['/api/', '/projects', '/settings', '/wallet']
    const localizedPrivateRoutes = localizedLocales.flatMap(locale => privateRoutes.slice(1).map(route => `/${locale}${route}`))
    const baseUrl = getSiteUrl()

    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: [...privateRoutes, ...localizedPrivateRoutes]
        },
        sitemap: new URL('/sitemap.xml', baseUrl).toString(),
        host: baseUrl.origin
    }
}
