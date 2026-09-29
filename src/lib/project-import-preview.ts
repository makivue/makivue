import { VISUAL_STYLE_PRESETS } from '@/lib/novel'
import type { DetectedScriptResult } from '@/services/script-import'

export interface ProjectImportPreview {
    stage: string
    totalEpisodes: number
    totalStoryboards: number
    detectedTitle?: string
    detectedGenre?: string
    recommendedVisualStyle: string
}

export function recommendImportVisualStyle(detected: DetectedScriptResult, rawText = ''): string {
    const content = `${detected.genre ?? ''}\n${detected.projectDescription ?? ''}\n${rawText.slice(0, 6000)}`.toLocaleLowerCase()
    const rules: Array<[RegExp, string]> = [
        [/(国漫|修仙|仙侠|玄幻|灵气|宗门)/i, 'cn-3d'],
        [/(魔法|魔兽|骷髅|亡灵|异世界|领主|城堡|奇幻)/i, 'fantasy-3d'],
        [/(武侠|江湖|侠客|门派)/i, 'wuxia-realism'],
        [/(古装|宫廷|皇帝|王妃|权谋|历史)/i, 'chinese-ink'],
        [/(科幻|机甲|赛博|星际|未来)/i, 'cyberpunk'],
        [/(悬疑|犯罪|侦探|推理| noir)/i, 'cinematic'],
        [/(校园|青春|同学|高中|大学)/i, 'campus-romance'],
        [/(都市|职场|总裁|现代|家庭|婚姻)/i, 'modern-drama'],
        [/(动漫|二次元|日系)/i, 'anime']
    ]
    const recommended = rules.find(([pattern]) => pattern.test(content))?.[1] ?? 'cinematic'
    return VISUAL_STYLE_PRESETS.some(style => style.key === recommended) ? recommended : VISUAL_STYLE_PRESETS[0].key
}

export function buildProjectImportPreview(detected: DetectedScriptResult, rawText: string): ProjectImportPreview {
    return {
        stage: detected.stage,
        totalEpisodes: detected.totalEpisodes ?? detected.episodes?.length ?? detected.outline?.length ?? 1,
        totalStoryboards: (detected.episodes ?? []).reduce((total, episode) => total + (episode.storyboards?.length ?? 0), 0),
        detectedTitle: detected.projectTitle,
        detectedGenre: detected.genre,
        recommendedVisualStyle: recommendImportVisualStyle(detected, rawText)
    }
}
