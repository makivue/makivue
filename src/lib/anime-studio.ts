import { getVisualStyle } from './novel'
import { isProjectEpisodeCount } from './project-metadata'

export const ANIME_STYLES = ['anime', 'cn-3d', 'graphic-novel', 'webtoon', 'q-version', 'anime-film'] as const
type AnimeStyle = (typeof ANIME_STYLES)[number]
export type AnimeImagePurpose = 'character' | 'frame' | 'poster'
export type AnimeDraft = {
    title: string
    story: string
    character: string
    style: AnimeStyle
    ratio: '9:16' | '16:9' | '1:1'
    episodes: number
    purpose: AnimeImagePurpose
}

export const EMPTY_ANIME_DRAFT: AnimeDraft = { title: '', story: '', character: '', style: 'anime', ratio: '9:16', episodes: 1, purpose: 'character' }

// Draft storage is optional. Never restore arbitrary provider URLs or asset IDs.
export function parseAnimeDraft(raw: string | null): AnimeDraft {
    try {
        const value = JSON.parse(raw || '{}')
        return {
            title: typeof value.title === 'string' ? value.title.slice(0, 255) : '',
            story: typeof value.story === 'string' ? value.story.slice(0, 18000) : '',
            character: typeof value.character === 'string' ? value.character.slice(0, 1000) : '',
            style: ANIME_STYLES.includes(value.style) ? value.style : 'anime',
            ratio: ['9:16', '16:9', '1:1'].includes(value.ratio) ? value.ratio : '9:16',
            episodes: isProjectEpisodeCount(value.episodes) ? value.episodes : 1,
            purpose: ['character', 'frame', 'poster'].includes(value.purpose) ? value.purpose : 'character'
        }
    } catch {
        return { ...EMPTY_ANIME_DRAFT }
    }
}

export function buildAnimeImagePrompt(draft: AnimeDraft): string {
    const style = getVisualStyle(draft.style)
    const composition = {
        character:
            'Character model sheet of ONE original character: front, side and back full-body views, plus three facial expressions. Consistent identity, face, hair, costume, proportions and palette in every view. Plain neutral background, no labels.',
        frame: 'A SINGLE storyboard opening keyframe, one camera angle, clear staging and screen direction. Depict the start of an action, before it is completed. No panel grid.',
        poster: 'A SINGLE polished original anime key visual, strong focal subject, clear silhouette, cinematic lighting, atmospheric background and balanced composition. No panel grid.'
    }[draft.purpose]
    return [
        style.imagePromptPrefix,
        composition,
        draft.character.trim(),
        draft.story.trim(),
        'Preserve the supplied reference identity and design when references are provided. No captions, speech bubbles, logos or watermarks.'
    ]
        .filter(Boolean)
        .join('\n\n')
}

export function buildAnimeProject(draft: AnimeDraft, contentLanguage: string, referenceAssetIds: string[]) {
    const description = [
        draft.story.trim(),
        draft.character.trim() ? `Character and scene design supplied by the creator:\n${draft.character.trim()}` : '',
        'Production direction: preserve the selected animation style throughout character references, scene references, storyboard frames and video. Lock character identity, costume, props and scene geography; split shots at meaningful action or dialogue boundaries. Review reference art before batch production. Keep subtitles and speech outside generated artwork.'
    ]
        .filter(Boolean)
        .join('\n\n')
    return {
        title: draft.title.trim() || draft.story.trim().slice(0, 60),
        description,
        visualStyle: draft.style,
        videoAspectRatio: draft.ratio,
        totalEpisodes: draft.episodes,
        episodeFormat: 'micro',
        contentLanguage,
        referenceAssetIds
    }
}
