import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { defaultLocale, isLocale, localeCookieName, localizePath, resolveRequestLocale } from '@/i18n/config'
// The application binds to loopback and rejects requests from other origins.
export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl
    // Next dev normalizes its internal URL to localhost; Origin must match the actual Host.
    let requestUrl: URL
    try {
        requestUrl = new URL(`${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}`)
    } catch {
        return NextResponse.json({ error: 'Invalid local host' }, { status: 403 })
    }
    const { hostname, origin } = requestUrl
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return NextResponse.json({ error: 'Local workspace only' }, { status: 403 })
    const callerOrigin = request.headers.get('origin')
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (callerOrigin && callerOrigin !== origin)) return NextResponse.json({ error: 'Cross-origin access is disabled' }, { status: 403 })
    if (pathname.startsWith('/api/wallet/recharge') || pathname.startsWith('/api/wallet/webhook/'))
        return NextResponse.json({ success: false, error: '本地工作区不使用充值或支付服务' }, { status: 410 })
    if (pathname.startsWith('/api/')) return NextResponse.next()

    const first = pathname.split('/').filter(Boolean)[0]
    const headers = new Headers(request.headers)
    const forwardedLocale = request.headers.get('x-app-locale')
    const forwardedPathname = request.headers.get('x-app-pathname')
    const storedLocale = request.cookies.get(localeCookieName)?.value
    const locale = resolveRequestLocale(first, forwardedLocale, storedLocale)
    // A rewrite can pass through Proxy more than once. Preserve the public
    // pathname and locale from the first pass instead of replacing them with
    // the internal rewritten path (`/`).
    headers.set('x-app-pathname', forwardedPathname || pathname)
    headers.set('x-app-locale', locale)
    if (first === defaultLocale) {
        const url = request.nextUrl.clone()
        url.pathname = pathname.slice(first.length + 1) || '/'
        // The default locale is canonical without an /en prefix. This is a
        // permanent URL normalization, unlike the cookie-driven locale hop.
        const response = NextResponse.redirect(url, 308)
        response.cookies.set(localeCookieName, defaultLocale, {
            path: '/',
            maxAge: 31536000,
            sameSite: 'lax'
        })
        return response
    }
    // Redirect old creation bookmarks before rendering starts; a redirect from
    // the page can otherwise become a client-side meta refresh during streaming.
    for (const [source, destination] of [
        ['/create/drama', '/'],
        ['/create/video', '/aivideo'],
        ['/create/image', '/aiimage']
    ]) {
        if (pathname === localizePath(source, locale)) {
            const url = request.nextUrl.clone()
            url.pathname = localizePath(destination, locale)
            return NextResponse.redirect(url, 308)
        }
    }
    if (!isLocale(first)) {
        // The production server can run Proxy again for the internal rewrite
        // destination. Redirect only new visits, not /fr/faq -> /faq -> /fr/faq.
        const isLocaleRewrite = isLocale(forwardedLocale) && forwardedPathname === localizePath(pathname, forwardedLocale)
        if (locale !== defaultLocale && !isLocaleRewrite) {
            const url = request.nextUrl.clone()
            url.pathname = localizePath(pathname, locale)
            return NextResponse.redirect(url, 307)
        }
        return NextResponse.next({ request: { headers } })
    }

    const url = request.nextUrl.clone()
    url.pathname = pathname.slice(first.length + 1) || '/'
    return NextResponse.rewrite(url, { request: { headers } })
}

export const config = {
    matcher: ['/api/:path*', '/((?!api|_next|_vercel|.*\\..*).*)']
}
