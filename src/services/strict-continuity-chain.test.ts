import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('strict continuity chain', () => {
    const batchRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
    const singleRoute = fs.readFileSync(path.join(root, 'src/services/storyboard-generation-handler.ts'), 'utf8')
    const episodeRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/route.ts'), 'utf8')
    const episodePage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const continuityRefresh = fs.readFileSync(path.join(root, 'src/services/storyboard-continuity.ts'), 'utf8')

    it('never substitutes a planned frame for the previous actual video tail', () => {
        for (const route of [batchRoute, singleRoute]) {
            expect(route).toContain("previous.videoStatus === 'completed'")
            expect(route).toContain('previous.actualVideoEndFrameUrl')
            expect(route).toContain('actual video ending frame')
            expect(route).toContain('缺少上一镜成功视频的真实尾帧，已阻断生成')
            expect(route).not.toContain('const plannedEndingFrameUrl = previous?.plannedLastFrameUrl')
        }
    })

    it('blocks a rejected continuity contract and propagates predecessor failure', () => {
        expect(batchRoute).toContain('const strictContinuityRejected =')
        expect(batchRoute).toContain('未通过串行门禁')
        expect(batchRoute).toContain('previousSucceeded === false')
        expect(batchRoute).toContain('上一连续镜头')
        expect(batchRoute).not.toContain('remains parallel')
    })

    it('regenerates a continuous opening frame from the current previous video tail', () => {
        expect(batchRoute).toContain("storyboard.continuityMode === 'continuous' || storyboard.continuityMode === 'seamless'")
        expect(batchRoute).toContain("sb.continuityMode === 'continuous' || sb.continuityMode === 'seamless'")
    })

    it('reclassifies legacy continuity before display and hides internal candidate wording', () => {
        expect(episodeRoute).toContain('await refreshEpisodeStoryboardContinuity(idNum)')
        expect(episodeRoute).toContain('continuityMode: true')
        expect(episodeRoute).toContain('continuityGroup: true')
        expect(episodeRoute).toContain('continuityReason: true')
        expect(episodePage).not.toContain('串行候选')
        expect(episodePage).not.toContain('候选严格串行')
        expect(episodePage).not.toContain('状态继承 · 并行')
        expect(episodePage).not.toContain("sb.continuityMode === 'seamless' ? '无缝连续'")
        expect(episodePage).not.toContain("sb.continuityMode === 'stateful' ? '状态继承'")
        expect(episodePage).not.toContain('`G${sb.continuityGroup}`')
        expect(episodePage).not.toContain('AI 会按台词长度、动作复杂度和镜头节奏分别推荐时长')
        expect(episodePage).not.toContain('<span className="text-xs text-gray-500">{sb.shotType')
        expect(episodePage).not.toContain('<LanguageSwitcher')
    })

    it('updates legacy continuity in grouped short statements instead of an expiring per-shot transaction', () => {
        expect(continuityRefresh).toContain('const updateGroups = new Map<')
        expect(continuityRefresh).toContain('prisma.storyboard.updateMany({')
        expect(continuityRefresh).not.toContain('prisma.$transaction(')
        expect(continuityRefresh).not.toContain('prisma.storyboard.update({')
    })
})
