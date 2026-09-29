import { getVideoProviderCapability, isHiModelsVeoProvider, type ProductionVideoProvider } from './provider-capabilities'

export type EmbeddedAudioVideoProvider = Exclude<ProductionVideoProvider, 'wanx'>
type VideoSpeechMode = 'native' | 'driving' | 'none'

export type VideoSpeechCapability = {
    mode: VideoSpeechMode
    label: string
    description: string
    supportsMultipleSpeakers: boolean
}

/**
 * Product-facing speech capability. The legacy `wanx` key now always maps to
 * HappyHorse 1.1, which does not provide native dialogue audio.
 */
export function getVideoSpeechCapability(provider: string | null | undefined, hasDialogue = true): VideoSpeechCapability {
    const capability = getVideoProviderCapability(provider)
    if (capability?.nativeDialogue && !isHiModelsVeoProvider(provider)) {
        return {
            mode: 'native',
            label: '模型原生对白',
            description:
                provider === 'wan3prime'
                ? 'Wan 3.0 Prime 在同一次视频生成中输出原生音画。'
                : provider === 'wan3'
                  ? 'Wan 3.0 在同一次视频生成中输出原生音画。'
                  : '画面、对白、口型、情绪和环境声同一次生成，表演协调性优先。',
            supportsMultipleSpeakers: true
        }
    }
    if (provider === 'wanx') {
        return {
            mode: 'none',
            label: '无原生对白音频',
            description: hasDialogue ? 'HappyHorse 1.1 只生成画面，不生成或驱动对白音频。' : 'HappyHorse 1.1 生成画面，官方接口不提供原生对白音频。',
            supportsMultipleSpeakers: false
        }
    }
    if (isHiModelsVeoProvider(provider)) {
        return {
            mode: 'native',
            label: '模型原生音频',
            description: '音频随视频生成，适合独立环境、氛围和特效镜头。',
            supportsMultipleSpeakers: true
        }
    }
    return {
        mode: 'none',
        label: '音频能力未知',
        description: '当前模型没有已验证的对白音频能力。',
        supportsMultipleSpeakers: false
    }
}

/** Current video providers return a finished video with its usable audio track embedded. */
export function usesEmbeddedVideoAudio(provider: string | null | undefined): provider is EmbeddedAudioVideoProvider {
    return getVideoProviderCapability(provider)?.embeddedAudio === true
}
