import { getVideoProviderCapability, isAvailableProductionVideoProvider, isHiModelsH3Provider, normalizeVideoDuration } from './provider-capabilities'
import { isLocale, type Locale } from '@/i18n/config'

export type VideoCreationMode = 'direct' | 'theme' | 'merge'
export type VideoThemePurpose = 'travel' | 'product' | 'knowledge' | 'story'
export type VideoThemeAudio = 'narration' | 'ambient'
export interface VideoThemeDraft {
    topic: string
    purpose: VideoThemePurpose
    audio: VideoThemeAudio
    language: Locale | ''
}
export interface VideoThemeInput extends Omit<VideoThemeDraft, 'language'> {
    language: Locale
    provider: string
    duration: number
    ratio: string
}
export interface VideoThemePlan {
    title: string
    prompt: string
}
export interface VideoThemePlanDraft extends VideoThemePlan {
    sourceKey: string
}

export function videoThemeSourceKey(input: VideoThemeInput) {
    return JSON.stringify([input.topic.trim(), input.purpose, input.audio, input.language, input.provider, input.duration, input.ratio])
}

export function parseVideoThemeInput(raw: unknown): VideoThemeInput {
    if (!raw || typeof raw !== 'object') throw new Error('主题参数无效')
    const value = raw as Record<string, unknown>
    const topic = typeof value.topic === 'string' ? value.topic.trim() : ''
    if (!topic || topic.length > 1000) throw new Error('请输入 1–1000 字的视频主题')
    if (typeof value.purpose !== 'string' || !['travel', 'product', 'knowledge', 'story'].includes(value.purpose)) throw new Error('视频用途无效')
    if (value.audio !== 'narration' && value.audio !== 'ambient') throw new Error('声音方式无效')
    if (typeof value.language !== 'string' || !isLocale(value.language)) throw new Error('视频语言无效')
    if (typeof value.provider !== 'string' || !isAvailableProductionVideoProvider(value.provider)) throw new Error('不支持的视频模型')
    const capability = getVideoProviderCapability(value.provider)
    if (value.audio === 'narration' && !capability?.nativeDialogue) throw new Error('当前模型不支持原生对白，请选择支持原生对白的视频模型。')
    if (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || normalizeVideoDuration(value.provider, value.duration) !== value.duration) throw new Error('视频时长超出所选模型范围')
    if (typeof value.ratio !== 'string' || !['16:9', '9:16', '1:1', ...(isHiModelsH3Provider(value.provider) ? ['21:9'] : [])].includes(value.ratio)) throw new Error('不支持的视频比例')
    return { topic, purpose: value.purpose as VideoThemePurpose, audio: value.audio, language: value.language, provider: value.provider, duration: value.duration, ratio: value.ratio }
}

export function parseVideoThemePlan(raw: unknown): VideoThemePlan {
    const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const title = typeof value?.title === 'string' ? value.title.trim() : ''
    const prompt = typeof value?.prompt === 'string' ? value.prompt.trim() : ''
    if (!title || title.length > 120 || !prompt || prompt.length > 4000) throw new Error('创作脚本不完整，请重新编写')
    return { title, prompt }
}
