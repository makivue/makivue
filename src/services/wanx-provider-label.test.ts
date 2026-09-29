import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Happy Horse provider retirement', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const creatorPage = fs.readFileSync(path.join(process.cwd(), 'src/app/create/CreatorWorkspace.tsx'), 'utf8')

    it('does not expose Happy Horse as a selectable video model', () => {
        expect(page).not.toContain("{ value: 'wanx', label: 'Happy Horse'")
        expect(creatorPage).not.toContain("{ value: 'wanx', label: 'Happy Horse'")
    })
})
