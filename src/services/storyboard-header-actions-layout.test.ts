import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('storyboard header action layout', () => {
    it('keeps compact icon actions in the shot header and deletion at the top of the expanded body', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        const styles = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')

        expect(page).toContain("'studio-shot-action whitespace-nowrap disabled:cursor-not-allowed'")
        expect(page).toContain('const headerIconButtonBase = `${headerButtonBase} is-icon-only`')
        expect(page).toContain('className="studio-shot-actions"')
        expect(styles).toContain('min-height: 28px')
        expect(styles).toContain('.studio-shot-action.is-icon-only')
        expect(styles).toContain('flex-basis: 28px')
        expect(styles).toContain('.studio-shot-toggle')
        expect(styles).toContain('.studio-shot-action.is-status:disabled')
        expect(page).toContain('className="studio-shot-toggle flex shrink-0')
        expect(page).toContain('className={`${headerIconButtonBase}')
        expect(page).toContain("frameSucceeded ? 'is-status' : ''")
        expect(page).toContain("videoGenerating || videoQueued ? 'is-status' : ''")
        expect(page).not.toContain("<span>{frameGenerating ? t('生成中')")
        expect(page).not.toContain("<span>{videoGenerating ? t('生成中')")
        expect(page).not.toContain('className="flex justify-end border-t border-gray-800 pt-4 lg:col-span-2"')
        expect(page).toContain("aria-label={deleting ? t('正在删除…') : t('删除分镜')}")
        expect(page).toContain("title={deleting ? t('正在删除…') : t('删除分镜')}")
        expect(page).not.toContain('className="studio-shot-delete"')
        expect(page).not.toContain('studio-shot-more')
        expect(styles).not.toContain('.studio-shot-delete')
    })

    it('keeps the episode steps at the upper left and removes redundant title and shot rails', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        const styles = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
        const headerStart = page.indexOf('<header className="studio-episode-header">')
        const tabs = page.indexOf('className="studio-episode-tabs novel-scroll"', headerStart)
        const actions = page.indexOf('className="studio-episode-actions"', headerStart)

        expect(tabs).toBeGreaterThan(headerStart)
        expect(actions).toBeGreaterThan(tabs)
        expect(page).not.toContain('className="studio-episode-title"')
        expect(page).not.toContain('className="studio-shot-art"')
        expect(page).not.toContain('当前分镜预计')
        expect(styles).toContain("grid-template-areas: 'tabs actions'")
        expect(styles).not.toContain('.studio-shot-art')
    })

    it('combines generation settings and destructive regeneration in one panel', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        const styles = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')

        expect(page).not.toContain('studio-action-more')
        expect(page).not.toContain('aria-label="更多操作"')
        expect(page).toContain('className="studio-settings-actions')
        expect(page).toContain('重新生成本集分镜</strong>')
        expect(page).toContain('全部重新生成</strong>')
        expect(page).toContain('function EpisodeGenerationSettings({')
        expect(page).toContain('const [open, setOpen] = useState(false)')
        expect(page).toContain('onClick={() => setOpen(value => !value)}')
        expect(page).toContain('className={`studio-generation-settings order-[40]')
        expect(page).toContain("title={t('生成设置')}")
        expect(page).not.toContain('<span className="hidden sm:inline">生成设置</span>')
        expect(page.match(/hidden=\{!open\}/g)).toHaveLength(2)
        expect(page).toContain('className="order-[60] flex flex-shrink-0 items-center gap-2 border-s')
        expect(styles).toContain('.studio-settings-actions')
    })

    it('keeps shot editing controls behind one compact settings row', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

        expect(page).toContain('const [showShotSettings, setShowShotSettings] = useState(false)')
        expect(page).toContain('aria-controls={`shot-${sb.id}-settings`}')
        expect(page).toContain('className="novel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 [color-scheme:dark]"')
        expect(page).toContain('<ShotSettingsField')
        expect(page).toContain('onClick={() => void save()}')
        expect(page).not.toContain('<ModalEditorSection')
        expect(page).not.toContain('setShowCharPicker')
    })
})
