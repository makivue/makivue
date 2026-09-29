import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('storyboard video button state', () => {
    const episodePage = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('immediately replaces a stale red failure state while a retry is being submitted', () => {
        expect(episodePage).toContain("const videoGenerating = submittingVideo || batchVideoRunning || (sb.videoStatus === 'generating' && !videoQueued)")
        expect(episodePage).toMatch(/className={`\$\{headerIconButtonBase\} \$\{[\s\S]*?videoGenerating[\s\S]*?border-purple-500\/50/)
        expect(episodePage).toContain('<RefreshCw className="h-4 w-4 animate-spin" />')
        expect(episodePage).toContain('aria-label={videoHeaderActionLabel}')
        expect(episodePage).not.toContain("videoGenerating ? t('生成中') : videoQueued ? t('排队') : t('视频')")
    })

    it('keeps the local submitting state until refreshed server state arrives', () => {
        expect(episodePage).toContain('await fetchAll()')
        expect(episodePage).toContain('否则请求返回与轮询更新之间会短暂恢复成旧的失败红色')
    })
})
