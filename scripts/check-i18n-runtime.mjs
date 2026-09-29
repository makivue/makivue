const baseUrl = (process.env.I18N_AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const locales = ['en', 'zh', 'fr', 'ar', 'id', 'hi', 'fil', 'ja', 'ko']
const suffixes = ['', '/faq', '/features/ai-short-drama-generator', '/features/ai-storyboard-generator', '/features/ai-video-generator']
const localesWithoutHanText = new Set(['en', 'fr', 'ar', 'id', 'hi', 'fil', 'ko'])
// These requests only render page shells; they do not submit jobs or mutate
// account data. Nested project routes cover shared workspace loading states.
const privatePaths = [
    '/create',
    '/aiimage',
    '/aivideo',
    '/profile',
    '/replica',
    '/projects',
    '/projects/1',
    '/projects/1/characters',
    '/projects/1/scenes',
    '/projects/1/episodes/1',
    '/settings',
    '/wallet',
    '/wallet/transactions'
]
const legalPaths = ['/legal/privacy', '/legal/terms', '/legal/cookies']
const noIndexPattern = /<meta[^>]+(?:name="robots"[^>]+content="noindex, nofollow"|content="noindex, nofollow"[^>]+name="robots")/

async function request(pathname, options = {}) {
    return fetch(`${baseUrl}${pathname}`, { ...options, signal: AbortSignal.timeout(30_000) })
}

function localizedPath(locale, suffix) {
    return locale === 'en' ? suffix || '/' : `/${locale}${suffix}`
}

function visibleText(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[^;]+;/g, ' ')
}

function userFacingText(html) {
    const attributes = [...html.matchAll(/\s(?:alt|title|placeholder|aria-label)=["']([^"']*)["']/gi)].map(match => match[1]).join(' ')
    return `${visibleText(html)} ${attributes}`
}

const errors = []
for (const locale of locales) {
    const legacyDrama = await request(localizedPath(locale, '/create/drama'), { redirect: 'manual' })
    if (legacyDrama.status !== 308 || legacyDrama.headers.get('location') !== localizedPath(locale, '')) errors.push(`${locale}: legacy drama route must redirect to the homepage`)
    for (const suffix of [...suffixes, ...privatePaths, ...legalPaths]) {
        const pathname = localizedPath(locale, suffix)
        const response = await request(pathname)
        const html = await response.text()

        if (response.status !== 200) errors.push(`${pathname}: HTTP ${response.status}`)
        if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${pathname}: missing localized title`)
        if (privatePaths.includes(suffix) && !noIndexPattern.test(html)) errors.push(`${pathname}: missing noindex, nofollow`)
        if (!new RegExp(`<html[^>]+lang=["']${locale}["']`).test(html)) errors.push(`${pathname}: incorrect html lang`)
        if (locale === 'ar' && !/<html[^>]+dir=["']rtl["']/.test(html)) errors.push(`${pathname}: missing RTL direction`)
        if (locale !== 'ar' && /<html[^>]+dir=["']rtl["']/.test(html)) errors.push(`${pathname}: unexpected RTL direction`)
        if (localesWithoutHanText.has(locale) && /[\u3400-\u9fff]/.test(userFacingText(html))) {
            errors.push(`${pathname}: visible text or accessibility attributes contain Chinese in ${locale}`)
        }
    }
}

const englishPrefix = await request('/en/projects?tab=novel', { redirect: 'manual' })
if (englishPrefix.status !== 308 || englishPrefix.headers.get('location') !== '/projects?tab=novel') {
    errors.push(`/en redirect: ${englishPrefix.status} ${englishPrefix.headers.get('location')}`)
}

const sitemap = await (await request('/sitemap.xml')).text()
const expectedPublicUrls = locales.length * suffixes.length
if ((sitemap.match(/<url>/g) || []).length !== expectedPublicUrls) errors.push(`sitemap must contain ${expectedPublicUrls} URLs`)
if ((sitemap.match(/hreflang="x-default"/g) || []).length !== expectedPublicUrls) errors.push('sitemap is missing x-default alternates')

if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exit(1)
}

const checkedRoutes = locales.length * (suffixes.length + privatePaths.length + legalPaths.length)
console.log(`i18n runtime check passed: ${checkedRoutes} localized routes, sitemap alternates, English redirect, RTL, private noindex`)
