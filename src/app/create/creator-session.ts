import { DEFAULT_VIDEO_PROVIDER, type ProductionImageProvider, type ProductionVideoProvider } from '@/lib/provider-capabilities'
import type { StoryboardReferenceVideo } from '@/lib/storyboard-reference-videos'
import type { SetStateAction } from 'react'

export type Mode = 'image' | 'video'
export type ImageModel = ProductionImageProvider
export type VideoModel = ProductionVideoProvider
export type AssetFilter = 'all' | Mode
export type AspectRatio = '1:1' | '21:9' | '16:9' | '9:16' | '4:3' | '3:4'

export interface CreatorAsset {
    id: string
    type: Mode
    url: string
    coverUrl: string | null
    prompt: string | null
    provider: string | null
    ratio: string | null
    duration: number | null
    createdAt: string
}
export interface CreatorSession {
    prompt: string
    ratios: AspectRatio[]
    imageModel: ImageModel
    videoModel: VideoModel
    duration: string
    files: File[]
    referenceAsset: CreatorAsset | null
    referenceVideos: StoryboardReferenceVideo[]
    uploadingReferenceVideos: boolean
    deletingReferenceVideoId: string | null
    resultUrl: string | null
    resultAsset: CreatorAsset | null
    resultAssets: CreatorAsset[]
    loading: boolean
    generationProgress: { done: number; total: number }
    error: string | null
    assets: CreatorAsset[]
    assetsLoading: boolean
    assetFilter: AssetFilter
    nextCursor: string | null
    galleryError: string | null
    coverTargetId: string | null
    coverUpdating: boolean
    deletingAssetIds: string[]
    selectingAssets: boolean
    selectedAssetIds: string[]
}

function createSession(mode: Mode): CreatorSession {
    return {
        prompt: '',
        ratios: [mode === 'image' ? '1:1' : '16:9'],
        imageModel: 'banana',
        videoModel: DEFAULT_VIDEO_PROVIDER,
        duration: '5',
        files: [],
        referenceAsset: null,
        referenceVideos: [],
        uploadingReferenceVideos: false,
        deletingReferenceVideoId: null,
        resultUrl: null,
        resultAsset: null,
        resultAssets: [],
        loading: false,
        generationProgress: { done: 0, total: 0 },
        error: null,
        assets: [],
        assetsLoading: false,
        assetFilter: 'all',
        nextCursor: null,
        galleryError: null,
        coverTargetId: null,
        coverUpdating: false,
        deletingAssetIds: [],
        selectingAssets: false,
        selectedAssetIds: []
    }
}

export function createCreatorSessions() {
    return { image: createSession('image'), video: createSession('video') }
}

export function updateCreatorSession<K extends keyof CreatorSession>(sessions: Record<Mode, CreatorSession>, mode: Mode, key: K, update: SetStateAction<CreatorSession[K]>) {
    const current = sessions[mode][key]
    const value = typeof update === 'function' ? (update as (previous: CreatorSession[K]) => CreatorSession[K])(current) : update
    if (Object.is(current, value)) return sessions
    return { ...sessions, [mode]: { ...sessions[mode], [key]: value } }
}

export function removeCreatorAssets(sessions: Record<Mode, CreatorSession>, assetIds: readonly string[]): Record<Mode, CreatorSession> {
    const deletedIds = new Set(assetIds)
    const removeFromSession = (session: CreatorSession): CreatorSession => {
        const resultAssets = session.resultAssets.filter(asset => !deletedIds.has(asset.id))
        const resultDeleted = session.resultAsset !== null && deletedIds.has(session.resultAsset.id)
        const resultAsset = resultDeleted ? (resultAssets[0] ?? null) : session.resultAsset
        return {
            ...session,
            assets: session.assets.filter(asset => !deletedIds.has(asset.id)),
            selectedAssetIds: session.selectedAssetIds.filter(id => !deletedIds.has(id)),
            resultAssets,
            resultAsset,
            resultUrl: resultDeleted ? (resultAsset?.url ?? null) : session.resultUrl,
            referenceAsset: session.referenceAsset && deletedIds.has(session.referenceAsset.id) ? null : session.referenceAsset
        }
    }
    return { image: removeFromSession(sessions.image), video: removeFromSession(sessions.video) }
}
