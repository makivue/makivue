import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('global language and appearance settings', () => {
    const routePages = [
        'src/app/page.tsx',
        'src/app/create/CreatorWorkspace.tsx',
        'src/app/profile/page.tsx',
        'src/app/settings/page.tsx',
        'src/app/features/[slug]/page.tsx',
        'src/app/projects/page.tsx',
        'src/app/replica/page.tsx',
        'src/app/wallet/page.tsx',
        'src/app/projects/[id]/ProjectWorkspace.tsx',
        'src/app/projects/[id]/episodes/[episodeId]/page.tsx'
    ]

    it('groups both settings in the shared site and workspace headers', () => {
        expect(source('src/app/layout.tsx')).not.toContain('<GlobalLanguageSwitcher')
        expect(source('src/app/layout.tsx')).not.toContain('<GlobalThemeSettings')
        expect(source('src/components/SiteHeader.tsx')).toContain('<GlobalPreferences />')
        expect(source('src/components/CreationJourney.tsx')).toContain('<GlobalPreferences')
        const preferences = source('src/components/GlobalPreferences.tsx')
        expect(preferences).toContain('<LanguageSwitcher')
        expect(preferences).toContain('<GlobalThemeSettings />')
        expect(preferences).toContain('popover="auto"')
        expect(preferences).not.toContain('fixed bottom-')
        expect(source('src/components/GlobalThemeSettings.tsx')).not.toContain('fixed bottom-')
        expect(source('src/components/LanguageSwitcher.tsx')).not.toContain('floating')
    })

    it('does not render route-specific language controls', () => {
        for (const file of routePages) expect(source(file)).not.toContain('<LanguageSwitcher')
    })
})
