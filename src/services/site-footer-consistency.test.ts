import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sitePages = [
    'src/app/page.tsx',
    'src/app/faq/page.tsx',
    'src/app/features/[slug]/page.tsx',
    'src/app/projects/page.tsx',
    'src/app/profile/page.tsx',
    'src/app/settings/page.tsx',
    'src/app/wallet/page.tsx',
    'src/app/wallet/transactions/page.tsx',
    'src/app/create/CreatorWorkspace.tsx',
    'src/app/replica/page.tsx',
    'src/app/legal/[document]/page.tsx'
]

describe('site chrome consistency', () => {
    it.each(sitePages)('%s uses the shared site header and footer', pagePath => {
        const source = fs.readFileSync(path.join(process.cwd(), pagePath), 'utf8')

        expect(source).toContain("import SiteHeader from '@/components/SiteHeader'")
        expect(source).toContain('<SiteHeader')
        expect(source).toContain("import SiteFooter from '@/components/SiteFooter'")
        expect(source).toContain('<SiteFooter />')
        expect(source).not.toContain('<footer')
    })

    it.each(['src/components/SiteHeader.tsx', 'src/components/SiteFooter.tsx'])('%s spans the full viewport width', componentPath => {
        const source = fs.readFileSync(path.join(process.cwd(), componentPath), 'utf8')

        expect(source).toContain('w-full')
    })

    it('keeps footer information without the redundant creation action', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/components/SiteFooter.tsx'), 'utf8')

        expect(source).not.toContain('home-footer-cta')
        expect(source).not.toContain('href="/projects"')
        expect(source).not.toContain("t('开始创作')")
        expect(source).toContain('<BrandLogo')
        expect(source).toContain("t('产品')")
        expect(source).toContain("t('资源')")
        expect(source).toContain('<LegalLinks')
    })

    it('keeps the footer logo unframed in every theme and hover state', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/components/SiteFooter.tsx'), 'utf8')
        const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
        const logoWrapper = source.match(/<span className="([^"]+)">\s*<BrandLogo/)?.[1]

        expect(source).toContain('<BrandLogo size={30} />')
        expect(logoWrapper).toBeDefined()
        expect(logoWrapper).not.toMatch(/border|rounded|bg-|shadow|ring/)
        expect(source).not.toContain('home-footer-brand-mark')
        expect(css).not.toContain('home-footer-brand-mark')
    })
})
