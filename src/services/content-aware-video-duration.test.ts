import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('content-aware video duration workflow', () => {
    const page = source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')
    const storyboardRoute = source('src/app/api/ai/storyboard/route.ts')
    const llm = source('src/services/llm.ts')
    const productionValidation = source('src/lib/script-production.ts')

    it('does not advertise or enforce one universal 4-15 second default', () => {
        expect(page).not.toContain('默认按镜头内容建议 4-15 秒')
        expect(page).not.toContain('AI 会按台词长度、动作复杂度和镜头节奏分别推荐时长')
        expect(page).not.toContain('globalVideoCapability?.duration.max')
    })
    it('passes the selected model duration limit to basic storyboard generation', () => {
        expect(page).toContain('videoProvider: globalVideoProvider')
        expect(storyboardRoute).toContain('maxShotDuration: getVideoProviderCapability(videoProvider)?.duration.max')
        expect(llm).toContain('Math.min(maximumDuration, Math.round(shot.duration))')
    })
    it('does not gate generation on middle-performance quality', () => {
        expect(productionValidation).not.toContain('needsMiddleState')
        expect(productionValidation).not.toContain('validateStoryboardProduction')
    })
})
