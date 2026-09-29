import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const projectPage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
const projectLayout = fs.readFileSync(path.join(root, 'src/app/projects/[id]/layout.tsx'), 'utf8')
const charactersPage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/characters/page.tsx'), 'utf8')
const scenesPage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/scenes/page.tsx'), 'utf8')

describe('project workspace routing', () => {
    it('keeps the project workspace mounted across dedicated character and scene URLs', () => {
        expect(projectLayout).toContain('<ProjectWorkspace initialTab={workspaceTab} />')
        expect(projectLayout).toContain("if (segments[2] === 'characters' || segments[2] === 'scenes') return segments[2]")
        expect(charactersPage).toContain('return null')
        expect(scenesPage).toContain('return null')
        expect(projectPage).toContain("if (tab === 'characters' || tab === 'scenes') return `/projects/${projectId}/${tab}`")
    })

    it('uses URL-backed links and shared navigation for project sections', () => {
        expect(projectPage).toContain('href={projectTabHref(id, key as ProjectTab)}')
        expect(projectPage).toContain("navigateToProjectTab('characters')")
        expect(projectPage).toContain("navigateToProjectTab('scenes')")
        expect(projectPage).toContain('updateWorkspaceUrl(projectTabHref(id, tab))')
        expect(projectPage).toContain("window.history.pushState(null, '', target)")
        expect(projectPage).toContain('onNavigate={event => {')
        expect(projectPage).toContain('event.preventDefault()')
        expect(projectPage).not.toContain('router.push(projectTabHref(id, tab)')
    })

    it('keeps legacy tab query links refresh-safe', () => {
        expect(projectPage).toContain('return `/projects/${projectId}?tab=${tab}`')
        expect(projectPage).toContain('getInitialProjectNavigation(initialTab)')
        expect(projectPage).toContain('return `/projects/${projectId}?tab=novel&stage=setup`')
    })

    it('keeps novel stages independent and treats the URL as the navigation source of truth', () => {
        expect(projectPage).not.toContain("prev === 'setup' && projectStage !== 'setup'")
        expect(projectPage).toContain('syncNavigationFromUrl()')
        expect(projectPage).toContain("window.addEventListener('popstate', syncNavigationFromUrl)")
        expect(projectPage).toContain('setNovelStageViewState(navigation.stage)')
    })

    it('does not expose the removed production-control tab', () => {
        expect(projectPage).not.toContain("'workflow' | 'insights'")
        expect(projectPage).not.toContain("projectTabHref(id, 'workflow')")
        expect(projectPage).not.toContain('生产总控')
        expect(projectPage).not.toContain('/pipeline-check')
    })
})
