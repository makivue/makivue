export const SITE_NAME = 'makivue'
export const SITE_OFFICIAL_URL = 'https://makivue.com?utm_source=github'
export const SITE_ORIGIN = 'http://localhost:3000'
export const SITE_CONTACT_EMAIL = ''
export const SITE_SOCIAL_IMAGE = {
    url: '/opengraph-image',
    width: 1200,
    height: 630,
    alt: `${SITE_NAME} — Local AI short drama and animation studio`
}

export function withSiteName(title: string): string {
    return title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`
}

export function getSiteUrl(): URL {
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
    try {
        const url = new URL(configured || SITE_ORIGIN)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return new URL(SITE_ORIGIN)
        return new URL(url.origin)
    } catch {
        return new URL(SITE_ORIGIN)
    }
}
