import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('workspace wallet balance visibility', () => {
    it('shows the balance on every standalone generation page', () => {
        expect(source('src/app/create/CreatorWorkspace.tsx')).toMatch(/userId && \(\s*<WalletBalance\b[^>]*userId=\{userId\}[^>]*compact/)
        expect(source('src/app/replica/page.tsx')).toContain('<WalletBalance compact />')
        expect(source('src/app/projects/page.tsx')).toContain('<WalletBalance compact />')
    })

    it('shows the balance throughout the novel and script workflow', () => {
        const novelTab = source('src/app/projects/[id]/NovelTab.tsx')

        expect(novelTab.match(/<WalletBalance compact \/>/g)).toHaveLength(4)
    })

    it('shows the balance on character and scene pages', () => {
        const projectWorkspace = source('src/app/projects/[id]/ProjectWorkspace.tsx')

        expect(projectWorkspace.match(/<ReferenceLibraryHeader/g)).toHaveLength(2)
        expect(source('src/components/ReferenceLibraryHeader.tsx')).toMatch(/<WalletBalance\b[^>]*\bcompact\b[^>]*\/>/)
    })

    it('keeps the balance visible at the far end of the storyboard action bar', () => {
        const storyboardWorkspace = source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')
        const headerStart = storyboardWorkspace.indexOf('<header className="studio-episode-header">')
        const wallet = storyboardWorkspace.indexOf('<WalletBalance compact />', headerStart)
        const settings = storyboardWorkspace.indexOf('<EpisodeGenerationSettings', headerStart)

        expect(headerStart).toBeGreaterThan(-1)
        expect(wallet).toBeGreaterThan(headerStart)
        expect(wallet).toBeGreaterThan(settings)
    })

    it('keeps the balance in batch generation but hides it from extraction review', () => {
        expect(source('src/app/projects/[id]/ExtractReviewModal.tsx')).not.toContain('WalletBalance')
        expect(source('src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx')).toContain('<WalletBalance compact />')
    })
})
