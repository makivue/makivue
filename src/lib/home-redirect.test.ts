import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { homepagePathFor, isUnavailablePageStatus, isValidRouteResourceId } from './home-redirect'

describe('protected deep-link redirects', () => {
    it('keeps the active locale when returning to the homepage', () => {
        expect(homepagePathFor('/projects/123')).toBe('/')
        expect(homepagePathFor('/zh/projects/123')).toBe('/zh')
        expect(homepagePathFor('/ja/projects/123/episodes/456')).toBe('/ja')
    })

    it('accepts only positive numeric resource ids', () => {
        expect(isValidRouteResourceId('629314679239344130')).toBe(true)
        expect(isValidRouteResourceId('')).toBe(false)
        expect(isValidRouteResourceId('undefined')).toBe(false)
        expect(isValidRouteResourceId('123abc')).toBe(false)
        expect(isValidRouteResourceId(undefined)).toBe(false)
    })

    it('redirects only for unavailable page responses', () => {
        for (const status of [400, 401, 403, 404]) expect(isUnavailablePageStatus(status)).toBe(true)
        for (const status of [200, 409, 429, 500, 503]) expect(isUnavailablePageStatus(status)).toBe(false)
    })

    it('redirects unmatched application URLs from the root not-found boundary', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/app/not-found.tsx'), 'utf8')
        expect(source).toContain("redirect(localizePath('/', locale))")
    })
})
