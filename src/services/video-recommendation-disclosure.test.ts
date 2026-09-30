import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('short-drama video model disclosure', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    const batchRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')
    const singleRoute = fs.readFileSync(path.join(process.cwd(), 'src/services/storyboard-generation-handler.ts'), 'utf8')
    const videoService = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
    const creatorPage = fs.readFileSync(path.join(process.cwd(), 'src/app/create/CreatorWorkspace.tsx'), 'utf8')
    const settingsPage = fs.readFileSync(path.join(process.cwd(), 'src/app/settings/page.tsx'), 'utf8')
    const homePage = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    const seoPages = fs.readFileSync(path.join(process.cwd(), 'src/lib/seo-pages.ts'), 'utf8')
    it('does not expose model recommendations or comparisons', () => {
        expect(page).not.toContain('showVideoRecommendation')
        expect(page).not.toContain('generateComparison')
    })
    it('keeps input capability guidance', () => {
        expect(page).toContain('当前模型不支持原生对白')
        expect(page).toContain('referenceVideoDurationRule')
    })

    it('exposes only user-controlled provider switching and locks batch jobs to the selection', () => {
        expect(page).toContain('const SHOW_SHORT_DRAMA_VIDEO_MODEL_CONTROLS = true')
        expect(page).toContain('useState<ProductionVideoProvider>(DEFAULT_VIDEO_PROVIDER)')
        expect(page).toContain('SHOW_SHORT_DRAMA_VIDEO_MODEL_CONTROLS && (')
        expect(page).toContain("{ value: 'seedance', label: SEEDANCE_20_LABEL")
        expect(page).toContain("{ value: 'seedance25', label: SEEDANCE_25_LABEL")
        expect(page).toContain("{ value: 'wan3', label: 'Wan 3.0'")
        expect(page).toContain("{ value: 'wan3prime', label: WAN_3_PRIME_LABEL")
        expect(page).toContain("{ value: 'seedance-2.0-global', label: 'Seedance 2.0 Global'")
        expect(page).toContain("{ value: 'MiniMax-H3', label: 'MiniMax H3'")
        expect(page).not.toContain("{ value: 'wanx', label: 'Happy Horse'")
        expect(page).not.toContain("{ value: 'veo-3.1-generate-001'")
        expect(page).not.toContain("{ value: 'veo-3.1-fast-generate-001'")
        expect(page).not.toContain("{ value: 'veo-3.1-lite-generate-001'")
        expect(page).toContain('支持 4-30 秒逐秒时长')
        expect(page).toContain('const [shotProviderTouched, setShotProviderTouched] = useState(false)')
        expect(page).toContain('if (!shotProviderTouched && defaultVideoProvider)')
        expect(page).toContain('setShotProviderTouched(true)')
        expect(batchRoute).toContain('const primaryVideoProvider = videoProviderOverride ?? (await resolveGlobalVideoProvider())')
        expect(batchRoute).toContain('const providerForStoryboard = () => videoProvider')
        expect(batchRoute).not.toContain('autoModelRouting')
    })

    it('blocks visual-only models for dialogue shots now that external dubbing is retired', () => {
        expect(page).toContain("const dialogueProviderSupported = !hasDialogue || speechCapability.mode === 'native'")
        expect(page).toContain('const canGenerateVideo = dialogueProviderSupported && referenceModeSupported && referenceFramesReady')
        expect(page).toContain('当前模型不支持原生对白，请选择支持原生对白的视频模型。')
        expect(singleRoute).toContain('不支持原生对白，请改用支持原生对白的视频模型')
        expect(videoService).not.toContain('不能把有对白镜头标记为完成')
        expect(batchRoute).toContain("code: 'VIDEO_PROVIDER_AUDIO_UNSUPPORTED'")
    })

    it('shows and preflights the selected model reference-video duration limits', () => {
        expect(page).toContain('readBrowserVideoDuration')
        expect(page).toContain("t('单条 {min}–{max} 秒', { min: referenceVideoDurationRule.min, max: referenceVideoDurationRule.max })")
        expect(page).toContain("t('合计不超过 {seconds} 秒', { seconds: referenceVideoDurationRule.totalMax })")
        expect(page).toContain('getReferenceVideoDurationViolation([...referenceVideos, ...durationCandidates], referenceVideoDurationRule)')
    })

    it('does not expose retired Veo models in product selectors or marketing', () => {
        for (const source of [page, creatorPage, settingsPage, homePage, seoPages]) {
            expect(source).not.toMatch(/veo-3\.1|\bveo3\b|\bVeo\b/i)
        }
    })
})
