import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode list merged video status', () => {
    const projectRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/projects/[id]/route.ts'), 'utf8')
    const episodePage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('returns a compact deliverable-video flag in project summaries', () => {
        expect(projectRoute).toContain('videoUrl: true')
        expect(projectRoute).toContain('hasMergedVideo:')
        expect(projectRoute).toContain("!episode.videoUrl.startsWith('/storage/')")
        expect(projectRoute).toContain('videoUrl: undefined')
    })

    it('shows an icon-only merged-video state and updates the current episode from merge polling', () => {
        expect(episodePage).toContain('const hasMergedVideo =')
        expect(episodePage).toContain("merge.status === 'completed' && merge.videoUrl")
        expect(episodePage).toContain('aria-label="本集成片已合成"')
        expect(episodePage).toContain('text-emerald-400')
        expect(episodePage).not.toContain('>本集成片已合成</')
    })
})
