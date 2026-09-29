import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('creator asset secondary creation', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/create/CreatorWorkspace.tsx'), 'utf8')

    it('makes the work card restore the saved generation settings', () => {
        expect(page).toContain('selectingAssets ? toggleAssetSelection(asset.id) : reuseAsset(asset)')
        expect(page).toContain("setPrompt(asset.prompt ?? '')")
        expect(page).toContain('setRatios([restoredRatio])')
        expect(page).toContain('setImageModel(asset.provider as ImageModel)')
        expect(page).toContain('setVideoModel(provider)')
        expect(page).toContain('normalizeVideoDuration(provider, asset.duration ?? 5)')
        expect(page).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })")
    })

    it('uses the selected work as the next request reference', () => {
        expect(page).toContain('setReferenceAsset(asset)')
        expect(page).toContain("if (referenceAsset?.type === 'image') form.append('referenceAssetId', referenceAsset.id)")
        expect(page).toContain("if (referenceAsset?.type === 'video') form.append('referenceVideoAssetId', referenceAsset.id)")
        expect(page).toContain('来自“我的作品”')
    })

    it('previews saved videos in the video tray without counting the cover as an image', () => {
        expect(page).toContain("const savedImageAsset = referenceAsset?.type === 'image' ? referenceAsset : null")
        expect(page).toContain("const savedVideoAsset = referenceAsset?.type === 'video' ? referenceAsset : null")
        expect(page).toContain('files.length + (savedImageAsset ? 1 : 0)')
        expect(page).toContain('referenceVideos.length + (savedVideoAsset ? 1 : 0)')
        expect(page).toContain('src={savedVideoAsset.url}')
        expect(page).toContain('open={referenceVideoCount > 0 || uploadingReferenceVideos}')
    })
})
