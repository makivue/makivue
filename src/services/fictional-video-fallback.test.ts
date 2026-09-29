import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('AI video provider lock', () => {
    it('does not expose or invoke live-person authentication from the character page', () => {
        const page = fs.readFileSync(path.join(root, 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
        const referenceRoute = fs.readFileSync(path.join(root, 'src/app/api/characters/[id]/reference/route.ts'), 'utf8')

        expect(page).not.toContain('/seedance-portrait/session')
        expect(page).not.toContain('开始认证')
        expect(referenceRoute).not.toContain('syncCharacterSeedancePortraitAssets')
    })

    it('keeps the requested video provider and retries through the official material library', () => {
        const service = fs.readFileSync(path.join(root, 'src/services/ai.ts'), 'utf8')
        const batchRoute = fs.readFileSync(path.join(root, 'src/app/api/episodes/[id]/generate-all/route.ts'), 'utf8')

        expect(service).toContain('return await runProvider(provider, referenceMode)')
        expect(service).toContain('createSeedanceTaskWithAssetRecovery({')
        expect(service).toContain('materialRecovery: created.recovery')
        expect(service.match(/const config = await getSeedanceConfig\(provider\)/g)).toHaveLength(2)
        expect(service).not.toContain('prepareStoryboardSeedancePortraitAssets')
        expect(service).not.toContain('getStoryboardSeedancePortraitAssetIds')
        expect(service).not.toContain('resolveFictionalVideoFallbackProvider')
        expect(service).not.toContain('recordVideoCompatibilitySwitch')
        expect(service).not.toContain('videoProviderSwitch')
        expect(batchRoute).toContain('const providerForStoryboard = () => videoProvider')
        expect(batchRoute).not.toContain('videoProviderByStoryboard')
    })

    it('does not claim that a failed video was switched to a fallback provider', () => {
        const page = fs.readFileSync(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

        expect(page).not.toContain('当前视频触发兼容性限制，已自动切换备用模型生成。')
        expect(page).not.toContain('InputImageSensitiveContentDetected.PrivacyInformation')
        expect(page).toContain('providerSwitched: false')
        expect(page).not.toContain('getVideoProviderSwitchNotice')
    })

    it('accepts inline video bytes from the compatibility channel instead of requiring a URI', () => {
        const service = fs.readFileSync(path.join(root, 'src/services/ai.ts'), 'utf8')
        expect(service).toContain('const { videoResult, usage: completedUsage } = await pollHiModelsVideoOperation')
        expect(service).toContain("if (videoResult.kind === 'inline')")
        expect(service).toContain('decodeVeoInlineVideo(videoResult)')
        expect(service).not.toContain('Veo 3 done but no video URI')
    })
})
