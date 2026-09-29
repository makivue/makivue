import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('homepage short-drama creation entry', () => {
    const source = read('src/app/page.tsx')
    const navigation = read('src/app/create/CreationModeNav.tsx')
    const creator = read('src/app/create/drama/DramaCreator.tsx')

    it('uses the homepage for AI drama and preserves image/video destinations', () => {
        expect(navigation).toContain("href={key === 'drama' ? '/' : `/ai${key}`}")
        expect(navigation).toContain("key: 'video'")
        expect(navigation).toContain("key: 'image'")
        expect(navigation).not.toContain('preventDefault')
        expect(navigation).not.toContain('requireAuth')
        expect(source).toContain('<CreationModeNav mode="drama" />')
        expect(source).toContain('<DramaCreator />')
        expect(source.match(/<h1\b/g)).toHaveLength(1)
    })

    it('redirects existing drama bookmarks to the localized homepage', () => {
        const legacyPage = read('src/app/create/drama/page.tsx')
        expect(legacyPage).toContain("get('x-app-locale')")
        expect(legacyPage).toContain("permanentRedirect(localizePath('/', locale))")
        expect(legacyPage).not.toContain('<DramaCreator')
    })

    it('requires a session at submission before creating and opening a project', () => {
        const submit = creator.slice(creator.indexOf('async function createProject'), creator.indexOf('\n    return ('))
        expect(submit.indexOf('await requireAuth()')).toBeGreaterThan(-1)
        expect(submit.indexOf('await requireAuth()')).toBeLessThan(submit.indexOf("clientFetch('/api/projects'"))
        expect(submit).toContain('router.push(`/projects/${json.data.id}`)')
        expect(creator).not.toContain("router.replace('/'")
    })

    it('keeps published works and visual styles below the creation form', () => {
        expect(source.indexOf('<HomeWorksShowcase />')).toBeGreaterThan(source.indexOf('<DramaCreator />'))
        expect(source.indexOf('<StylePosterWall rows={STYLE_SHOWCASE_ROWS} />')).toBeGreaterThan(source.indexOf('<HomeWorksShowcase />'))
        const works = read('src/components/HomeWorksShowcase.tsx')
        expect(works).toContain('const HOME_WORK_LIMIT = 20')
        expect(works).toContain('`/api/works?limit=${HOME_WORK_LIMIT}`')
        expect(works).toContain('json.data.works.slice(0, HOME_WORK_LIMIT)')
    })

    it('shares creator drafts across home and image/video navigation', () => {
        const root = read('src/app/layout.tsx')
        const createLayout = read('src/app/create/layout.tsx')
        expect(root).toContain('<CreatorSessionProvider>')
        expect(createLayout).not.toContain('<CreatorSessionProvider>')
    })
})
