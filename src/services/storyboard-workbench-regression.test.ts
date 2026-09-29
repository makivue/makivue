import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const page = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
const modal = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx'), 'utf8')

describe('storyboard workbench regressions', () => {
    it('keeps the storyboard tabs and prioritized actions in one responsive header', () => {
        expect(page).toContain('className="studio-episode-header"')
        expect(page).toContain('className="studio-episode-tabs novel-scroll"')
        expect(page).toContain('className="studio-episode-actions"')
        expect(page).toContain("{activeTab === 'storyboard' && (")
        expect(page).toContain('className="studio-settings-actions')
        expect(page).toContain('重新生成本集分镜')
        expect(page).toContain('添加分镜')
    })

    it('does not expose internal scheduling or shot-type diagnostics in collapsed rows', () => {
        expect(page).not.toContain('状态与连续调度')
        expect(page).not.toContain('串行候选')
        expect(page).not.toContain('状态继承 · 并行')
        expect(page).not.toContain("sb.continuityMode === 'seamless' ? '无缝连续'")
        expect(page).not.toContain("sb.continuityMode === 'stateful' ? '状态继承'")
        expect(page).not.toContain('`G${sb.continuityGroup}`')
        expect(page).not.toContain('<span className="text-xs text-gray-500">{sb.shotType')
    })

    it('only offers full media regeneration when generated media exists', () => {
        expect(page).toContain('const hasGeneratedMedia =')
        expect(page).toContain('{hasGeneratedMedia && (')
        expect(page).toContain('storyboard.illustrations?.some(illustration => !!illustration.url)')
    })

    it('deduplicates the development Strict Mode batch start request', () => {
        expect(page).toContain('requestId={episodeBatchRequestId}')
        expect(modal).toContain('const batchStartRequestCache = new Map')
        expect(modal).toContain('startBatchOnce(startKey')
        expect(modal).toContain('${episodeId}:${requestId}:${retryKey}:${requestMode}')
    })

    it('shows only model names in the per-shot video model selector', () => {
        expect(page).toContain("{ value: 'seedance', label: SEEDANCE_20_LABEL }")
        expect(page).toContain("{ value: 'seedance25', label: SEEDANCE_25_LABEL }")
        expect(page).not.toContain("{ value: 'wanx', label: 'Happy Horse' }")
        expect(page).toContain("{ value: 'seedance-2.0-global', label: 'Seedance 2.0 Global' }")
        expect(page).toContain("{ value: 'MiniMax-H3', label: 'MiniMax H3' }")
        expect(page).not.toContain("{ value: 'veo-3.1-generate-001'")
        expect(page).not.toContain("{ value: 'veo-3.1-fast-generate-001'")
        expect(page).not.toContain("{ value: 'veo-3.1-lite-generate-001'")
        expect(page).not.toContain('2.0 原生对白；离散时长档位')
        expect(page).not.toContain('原生对白；4-30 秒逐秒选择')
    })
})
