import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public works genre filter', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/components/WorksShell.tsx'), 'utf8')
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/works/page.tsx'), 'utf8')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/components/works.css'), 'utf8')

    it('uses a compact collapsible top filter instead of a sidebar', () => {
        expect(shell).not.toContain('works-sidebar')
        expect(page).toContain('<details className="works-genre-filter">')
        expect(page).toContain('className="works-genre-options"')
        expect(page).toContain('className="works-genre-current"')
        expect(css).toMatch(/\.works-genre-options\s*\{[^}]*overflow-x: auto;/s)
        expect(css).not.toContain('.works-sidebar')
    })
})
