import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('published project cover cards', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/page.tsx'), 'utf8')
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/projects/route.ts'), 'utf8')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')

    it('shows a cover layout only for published projects', () => {
        expect(route).toContain('coverUrl: true')
        expect(route).toContain('visibility: true')
        expect(page).toContain("const published = p.visibility === 'public'")
        expect(page).toContain('data-published={published')
        expect(page).toContain('className="studio-library-project-cover"')
        expect(page).toContain('src={p.coverUrl}')
        expect(css).toContain(".studio-library-project[data-published='true'] .studio-library-project-link")
    })
})
