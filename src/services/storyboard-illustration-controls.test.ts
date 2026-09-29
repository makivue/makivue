import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('storyboard illustration controls', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('keeps extra-frame selection automatic and out of the primary shot workflow', () => {
        expect(source).not.toContain('额外插图数量')
        expect(source).not.toContain('本次共生成')
        expect(source).not.toContain('简单镜头生成 1 张主插图')
        expect(source).not.toContain('middleFrameSetting')
        expect(source).toContain("onGenerate('illustrations', videoProvider, undefined, imageProvider, imageQuality, illustrationCount)")
    })

    it('does not repeat generated output counts in a separate shot-assets summary', () => {
        expect(source).not.toContain('镜头素材')
        expect(source).not.toContain('assetSummary')
    })
})
