import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('episode regenerate-all UI', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const modal = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx'), 'utf8')
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
    const artifacts = fs.readFileSync(path.join(process.cwd(), 'src/services/artifacts.ts'), 'utf8')

    it('keeps missing generation as the primary safe action and exposes a separate full regeneration action', () => {
        expect(page).toContain("onClick={() => openEpisodeBatch('missing')}")
        expect(page).toContain('全部重新生成')
        expect(page).toContain("if (confirmed) openEpisodeBatch('all')")
    })

    it('hides full regeneration until the episode has generated media', () => {
        expect(page).toContain('const hasGeneratedMedia =')
        expect(page).toContain('storyboard.illustrations?.some(illustration => !!illustration.url)')
        expect(page).toContain('{hasGeneratedMedia && (')
    })

    it('requires an explicit cost-and-overwrite confirmation', () => {
        expect(page).toContain("title: '重新生成全部插图和视频'")
        expect(page).toContain('重新计费')
        expect(page).toContain('将先删除本集全部')
        expect(page).toContain('整集合成视频')
        expect(page).toContain("confirmText: '确认全部重新生成'")
        expect(page).toContain('本集仍有生成任务。继续后会先暂停这些任务')
        expect(page).not.toContain('disabled={hasActiveMediaTasks}')
    })

    it('atomically clears every episode media field and old generation before starting all mode', () => {
        expect(route).toContain("if (mode === 'all')")
        expect(route).toContain('await resetEpisodeGeneratedMedia(episodeId, episode.operationVersion)')
        expect(route).toContain("resetApplied: mode === 'all'")
        expect(route).toMatch(/after\(\(\) =>\s*withHiModelsUsageScope\(\{ userId, jobId: job.id \}, async \(\) => \{/)
        expect(route.indexOf('await resetEpisodeGeneratedMedia(episodeId, episode.operationVersion)')).toBeLessThan(route.indexOf('after(() =>'))
        expect(artifacts).toContain('firstFrameUrl: null')
        expect(artifacts).toContain('plannedLastFrameUrl: null')
        expect(artifacts).toContain('actualVideoEndFrameUrl: null')
        expect(artifacts).toContain('videoUrl: null')
        expect(artifacts).toContain('audioUrl: null')
        expect(artifacts).toContain('composedVideoUrl: null')
        expect(artifacts).toContain('await tx.generation.deleteMany')
        expect(artifacts).toContain('await tx.videoMerge.deleteMany')
        expect(artifacts).toContain('operationVersion: { increment: 1 }')
        expect(modal).toContain('onStartedRef.current?.(nextJobId, json.data?.resetApplied === true)')
        expect(page).toContain('if (resetApplied) clearEpisodeGeneratedMediaInView()')
        expect(page).toContain('illustrations: []')
        expect(page).toContain('merges: []')
    })

    it('passes all mode only for the initial full run and retries interrupted work in missing mode', () => {
        expect(page).toContain('mode={episodeBatchMode}')
        expect(modal).toContain("const [requestMode, setRequestMode] = useState<'missing' | 'all'>(mode)")
        expect(modal).toContain('body: JSON.stringify({ mode: requestMode')
        expect(modal).toContain("setRequestMode('missing')")
        expect(route).toContain("mode === 'all' || !sb.firstFrameUrl")
        expect(route).toContain("const shouldGenerateIllustrations = mode === 'all' || !sb.firstFrameUrl")
    })
})
