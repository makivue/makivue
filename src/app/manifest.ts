import type { MetadataRoute } from 'next'
import { SEO_LOCALE } from '@/i18n/seo'
import { SITE_NAME } from '@/lib/seo'

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: SITE_NAME,
        short_name: SITE_NAME,
        description: SEO_LOCALE.en.description,
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#080b12',
        theme_color: '#080b12',
        icons: [
            { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    }
}
