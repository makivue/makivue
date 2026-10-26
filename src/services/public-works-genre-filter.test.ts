import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public works genre filter', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/components/WorksShell.tsx'), 'utf8')
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/works/page.tsx'), 'utf8')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/components/works.css'), 'utf8')

    it('keeps all genre links visible in a wrapping top filter', () => {
        expect(shell).not.toContain('works-sidebar')
        expect(page).toContain('<div className="works-genre-filter">')
        expect(page).toContain('className="works-genre-options"')
        expect(page).not.toContain('works-genre-current')
        expect(css).toMatch(/\.works-genre-options\s*\{[^}]*flex-wrap: wrap;/s)
    })
})
