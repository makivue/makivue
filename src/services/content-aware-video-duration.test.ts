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
        expect(page).toContain('recommendStoryboardDuration')
        expect(page).toContain('getVideoProviderCapability(globalVideoProvider)?.duration.max')
    })

    it('plans storyboards against the selected video model capability', () => {
        expect(page).toContain('videoProvider: globalVideoProvider')
        expect(storyboardRoute).toContain('maxShotDuration: getVideoProviderCapability(videoProvider)?.duration.max')
        expect(llm).toContain('duration: normalizeStoryboardDuration(sb.duration, normalized, maxShotDuration)')
        expect(llm).toContain('当前视频模型单镜上限为 ${maxShotDuration} 秒')
    })

    it('does not use planned duration as a middle-performance requirement', () => {
        expect(productionValidation).not.toContain("shot.duration === 'number' && shot.duration >= 6")
        expect(productionValidation).toContain('const needsMiddleState = hasDialogue || hasNarration')
        expect(productionValidation).not.toContain('6 秒以上或含对白/旁白')
        expect(llm).not.toContain('时长达到 6 秒或含 dialogue/narration')
    })
})
