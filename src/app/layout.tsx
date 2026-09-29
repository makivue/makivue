import type { Metadata } from 'next'
import { headers } from 'next/headers'
import localFont from 'next/font/local'
import { Suspense } from 'react'
import './globals.css'
import CreatorSessionProvider from '@/app/create/CreatorSessionProvider'
import SignInProvider from '@/components/SignInProvider'
import ToastHost from '@/components/Toast'
import I18nProvider from '@/i18n/I18nProvider'
import { isLocale, localeDirection, localizePath, stripLocale } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { SITE_NAME } from '@/lib/seo'
import { buildHomeJsonLd, buildPublicMetadata } from '@/lib/seo-metadata'
import { APP_THEME_BOOTSTRAP_SCRIPT, DEFAULT_APP_THEME } from '@/lib/app-theme'

// Next 16 自带同一份 Geist 字体。直接本地打包，避免构建机访问
// fonts.googleapis.com 超时导致整次生产发布失败。
const geist = localFont({
    src: '../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2',
    variable: '--font-geist-sans',
    weight: '100 900',
    style: 'normal',
    display: 'swap'
})

export async function generateMetadata(): Promise<Metadata> {
    const requestHeaders = await headers()
    const requestedLocale = requestHeaders.get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : 'en'
    const pathname = requestHeaders.get('x-app-pathname') || localizePath('/', locale)
    const copy = SEO_LOCALE[locale]
    return {
        ...buildPublicMetadata(locale, pathname, copy),
        title: { default: copy.title, template: `%s | ${SITE_NAME}` }
    }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const requestHeaders = await headers()
    const requestedLocale = requestHeaders.get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : 'en'
    const publicPathname = requestHeaders.get('x-app-pathname') || localizePath('/', locale)
    const unlocalizedPathname = stripLocale(publicPathname)
    const isPublicHome = unlocalizedPathname === '/'
    const isServerLocalized = isPublicHome || unlocalizedPathname.startsWith('/features/') || unlocalizedPathname.startsWith('/legal/')
    const jsonLd = isPublicHome ? buildHomeJsonLd(locale) : null
    return (
        <html
            lang={locale}
            dir={localeDirection(locale)}
            data-app-theme={DEFAULT_APP_THEME}
            data-home-theme={DEFAULT_APP_THEME}
            data-app-tone="dark"
            suppressHydrationWarning
            className={`${geist.variable} h-full${locale === 'zh' || isServerLocalized ? '' : ' i18n-pending'}`}>
            <head>
                <script
                    data-i18n-skip
                    dangerouslySetInnerHTML={{ __html: APP_THEME_BOOTSTRAP_SCRIPT }}
                />
            </head>
            <body className="min-h-full bg-gray-950 text-gray-100 antialiased">
                <Suspense fallback={null}>
                    <I18nProvider initialLocale={locale}>
                        {jsonLd ? (
                            <script
                                type="application/ld+json"
                                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
                            />
                        ) : null}
                        <SignInProvider>
                            <CreatorSessionProvider>
                                <div className="global-i18n-content">{children}</div>
                            </CreatorSessionProvider>
                            <ToastHost />
                        </SignInProvider>
                    </I18nProvider>
                </Suspense>
            </body>
        </html>
    )
}
