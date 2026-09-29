import { localeFromPathname, localizePath, stripLocale } from '@/i18n/config'

const UNAVAILABLE_PAGE_STATUSES = new Set([400, 401, 403, 404])
let redirectPending = false

export function isValidRouteResourceId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9]\d*$/.test(value)
}

export function isUnavailablePageStatus(status: number): boolean {
    return UNAVAILABLE_PAGE_STATUSES.has(status)
}

export function homepagePathFor(pathname: string): string {
    return localizePath('/', localeFromPathname(pathname))
}

/**
 * Leave an invalid protected deep link with a full navigation. A hard replace
 * also clears stale page state and error toasts left by concurrent requests.
 */
export function redirectToHomepage(): boolean {
    if (typeof window === 'undefined') return false
    if (stripLocale(window.location.pathname) === '/') return false
    if (redirectPending) return true

    redirectPending = true
    window.location.replace(homepagePathFor(window.location.pathname))
    return true
}
