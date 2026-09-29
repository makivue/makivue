import { parseApiId } from '@/lib/api-id'
import type { CreatorReferenceVideo } from '@/lib/creator-reference-video'
import { MAX_STORYBOARD_REFERENCE_VIDEOS } from '@/lib/storyboard-reference-videos'
import { findCreatorAssetReference } from './creator-assets'
import { localMediaMatchesSubdirectory } from './local-media'

export class CreatorReferenceVideoError extends Error {
    constructor(
        message: string,
        public status = 400
    ) {
        super(message)
    }
}

export async function readCreatorVideoAssetReferences(form: FormData, userId: bigint): Promise<CreatorReferenceVideo[]> {
    const entries = form.getAll('referenceVideoAssetId')
    if (entries.length > MAX_STORYBOARD_REFERENCE_VIDEOS) throw new CreatorReferenceVideoError(`最多上传 ${MAX_STORYBOARD_REFERENCE_VIDEOS} 个参考视频`)
    const videos: CreatorReferenceVideo[] = []
    for (const entry of entries) {
        const id = typeof entry === 'string' ? parseApiId(entry.trim()) : null
        if (id === null) throw new CreatorReferenceVideoError('参考视频 ID 无效')
        const result = await findCreatorAssetReference(userId, id)
        if (!result) throw new CreatorReferenceVideoError('参考作品不存在', 404)
        const { asset } = result
        if (asset.type !== 'video') throw new CreatorReferenceVideoError('参考视频参数无效')
        if (!localMediaMatchesSubdirectory(asset.url, `creator/${userId}/videos`)) throw new CreatorReferenceVideoError('参考视频地址无效')
        if (!asset.duration || !Number.isFinite(asset.duration) || asset.duration <= 0) throw new CreatorReferenceVideoError('参考视频无效或时长为 0')
        videos.push({ id: asset.id, url: asset.url, name: `video-${asset.id}.mp4`, durationSeconds: asset.duration })
    }
    return videos
}
