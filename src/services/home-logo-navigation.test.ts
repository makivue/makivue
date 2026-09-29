import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const homeLogoPages = [
    'src/app/create/CreatorWorkspace.tsx',
    'src/app/profile/page.tsx',
    'src/app/settings/page.tsx',
    'src/app/wallet/page.tsx',
    'src/app/wallet/transactions/page.tsx',
    'src/app/replica/page.tsx',
    'src/app/projects/[id]/ProjectWorkspace.tsx',
    'src/app/projects/[id]/episodes/[episodeId]/page.tsx',
    'src/app/projects/[id]/publication/page.tsx'
]

const existingBrandPages = ['src/app/page.tsx', 'src/app/projects/page.tsx', 'src/app/faq/page.tsx', 'src/app/features/[slug]/page.tsx', 'src/app/legal/[document]/page.tsx']

describe('home logo navigation', () => {
    it('uses one localized, accessible home link component', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/components/HomeLogoLink.tsx'), 'utf8')

        expect(source).toContain("import Link from '@/i18n/navigation'")
        expect(source).toContain('href="/"')
        expect(source).toContain("t('返回首页')")
        expect(source).toContain('<BrandLogo')
    })

    it.each(homeLogoPages)('%s exposes the shared home logo', pagePath => {
        const source = fs.readFileSync(path.join(process.cwd(), pagePath), 'utf8')

        expect(source).toContain("import HomeLogoLink from '@/components/HomeLogoLink'")
        expect(source).toContain('<HomeLogoLink')
    })

    it.each(existingBrandPages)('%s keeps its existing brand linked to home', pagePath => {
        const source = fs.readFileSync(path.join(process.cwd(), pagePath), 'utf8')

        expect(source).toContain('<BrandLogo')
        expect(source.includes('href="/"') || source.includes("href={localizePath('/', locale)}")).toBe(true)
    })

    it('makes the works header brand return to the homepage', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/components/WorksShell.tsx'), 'utf8')
        const brandLink = source.match(/<Link\s+href="\/"\s+className="works-brand"[\s\S]+?<\/Link>/)?.[0]

        expect(brandLink).toBeDefined()
        expect(brandLink).toContain('<BrandLogo')
        expect(brandLink).toContain("t('返回首页')")
    })
})
