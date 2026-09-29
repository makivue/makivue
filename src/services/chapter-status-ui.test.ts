import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chapter generation status UI', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/NovelTab.tsx'), 'utf8')

    it('does not render the redundant chapter progress summary above the episode list', () => {
        expect(source).not.toContain('正文已生成')
        expect(source).not.toContain('generatedCount')
        expect(source).not.toContain('finishedCount')
    })

    it.each(['生成中', '即将', '已定稿', '失败', '已生成', '未生成'])('renders a labeled %s state instead of a color-only dot', label => {
        expect(source).toContain(`t('${label}')`)
    })

    it('keeps selection highlighting separate from generation state', () => {
        expect(source).toContain("aria-current={isActive ? 'true' : undefined}")
        expect(source).toContain('const epFailed = !epHasContent')
    })

    it('uses the completed journey green for finalized chapter numbers and labels', () => {
        expect(source).toContain("? 'bg-emerald-500/10 text-emerald-400'")
        expect(source).toContain('border-emerald-400/35 bg-emerald-500/10')
        expect(source).not.toContain('text-emerald-200/75')
    })

    it('renders explicit script adaptation states and trusts loaded script content', () => {
        expect(source).toContain('const done = isLocked(ep.status) || episodeHasScript(ep)')
        for (const label of ['拆分中', '排队中', '已分镜', '已拆剧本', '待拆分']) {
            expect(source).toContain(`ui('${label}'`)
        }
        expect(source).not.toContain('<span className="w-1.5 h-1.5 rounded-full bg-gray-600 flex-shrink-0" />')
    })

    it('keeps a failed script visible with direct retry and chapter-edit actions', () => {
        expect(source).toContain('const selectedScriptIssue = scriptBatchIssue?.episodeId === sel.id')
        expect(source).toContain("retryLabel={ui('重新拆本集', 'Re-adapt this episode')}")
        expect(source).toContain("editLabel={ui('返回章节修改', 'Back to edit chapter')}")
        expect(source).toContain('setSelectedChapterId(sel.id)')
        expect(source).toContain("setNovelStageView('drafting')")
    })
})
