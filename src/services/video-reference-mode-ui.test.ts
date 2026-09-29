import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('video reference mode selector', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('uses concise video generation labels without changing the mode keys', () => {
        expect(page).toContain("{ key: 'text', label: '文生视频'")
        expect(page).toContain("{ key: 'single', label: '首帧'")
        expect(page).toContain("{ key: 'first_last', label: '首尾帧'")
        expect(page).toContain('首尾帧模式至少需要两张插图，并且必须包含首图和末图')
    })

    it('renders the modes as a compact, visually subdued control', () => {
        expect(page).toContain('className="inline-flex w-fit rounded-md border border-gray-800')
        expect(page).not.toContain('<label className="text-[11px] text-gray-500">参考方式</label>')
        expect(page).not.toContain('<span className="text-[10px] text-gray-600">影响视频衔接</span>')
    })

    it('binds the selected mode to the video action instead of forcing single-frame generation', () => {
        expect(page).toContain('async function generateHeaderVideo()')
        expect(page).toContain('await generateVideo()')
        expect(page).not.toContain("await generateVideo('single')")
    })
})
