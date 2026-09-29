import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('re-extract replaces the old character and scene library', () => {
    const root = process.cwd()
    const modal = fs.readFileSync(path.join(root, 'src/app/projects/[id]/ExtractReviewModal.tsx'), 'utf8')
    const route = fs.readFileSync(path.join(root, 'src/app/api/ai/extract/commit/route.ts'), 'utf8')
    const clearRoute = fs.readFileSync(path.join(root, 'src/app/api/projects/[id]/extracted-entities/route.ts'), 'utf8')
    const clearService = fs.readFileSync(path.join(root, 'src/services/extracted-entities.ts'), 'utf8')
    const page = fs.readFileSync(path.join(root, 'src/app/projects/[id]/page.tsx'), 'utf8')

    it('uses the in-app confirmation and clears existing data before extraction starts', () => {
        expect(modal).toContain('setReplaceAllOnCommit(true)')
        expect(modal).toContain('replaceAll: replaceAllOnCommit')
        expect(modal).toContain("mode: replaceAllOnCommit ? 'add' : c._mode")
        expect(modal).toContain('replaceAll ? (')
        expect(modal).toContain('>全新入库</span>')
        expect(modal).toContain("title: t('清空并重新提取角色、场景？')")
        expect(modal).toContain('confirmDialog')
        expect(modal).not.toContain('window.confirm')
        expect(modal).toContain("window.localStorage.setItem(extractResetStorageKey(projectId), '1')")
        const clearRequest = modal.indexOf("clientFetch(`/api/projects/${projectId}/extracted-entities`, { method: 'DELETE' })")
        const extractionStart = modal.indexOf("setPhase('analyzing')", clearRequest)
        expect(clearRequest).toBeGreaterThan(0)
        expect(extractionStart).toBeGreaterThan(clearRequest)
        expect(clearRoute).toContain('clearProjectExtractedEntitiesInTransaction')
    })

    it('physically deletes old entities, reference assets and bindings in one transaction', () => {
        expect(route).toContain('const replaceAll = body.replaceAll === true')
        expect(route).toContain("const mode = replaceAll ? 'add' : commitMode(request.mode)")
        expect(clearService).toContain('await tx.characterReferenceAsset.deleteMany')
        expect(clearService).toContain('await tx.seedancePortraitAsset.deleteMany')
        expect(clearService).toContain('await tx.storyboardCharacter.deleteMany')
        expect(clearService).toContain('await tx.character.deleteMany')
        expect(clearService).toContain('await tx.scene.deleteMany')
        expect(clearService).toContain('await markProjectVisualsStaleInTransaction')
    })

    it('automatically regenerates characters first and scenes second from the fresh project', () => {
        expect(page).toContain('if (!payload.replaceAll)')
        const characters = page.indexOf("await generateAllCharRefs('all', { sourceProject: refreshedProject, confirm: false, replaceSelected: true })")
        const scenes = page.indexOf("await generateAllSceneRefs('all', afterCharacters, { confirm: false })")
        expect(characters).toBeGreaterThan(0)
        expect(scenes).toBeGreaterThan(characters)
    })
})
