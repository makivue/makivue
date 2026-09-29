import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('generated media image delivery', () => {
    const episodePage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const projectPage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
    const media = fs.readFileSync(path.join(process.cwd(), 'src/services/local-media.ts'), 'utf8')

    it('uses responsive local storage images for storyboard and reference previews', () => {
        expect(episodePage).toContain("import OptimizedMediaImage from '@/components/OptimizedMediaImage'")
        expect(episodePage).not.toContain('@next/next/no-img-element')
        expect(projectPage).toContain('quality={78}')
        expect(projectPage).toContain('quality={85}')
    })

    it('serves local files with private cache and content type boundaries', () => {
        expect(media).toContain("'Cache-Control': 'private, no-cache'")
        expect(media).toContain("'X-Content-Type-Options': 'nosniff'")
    })
})
