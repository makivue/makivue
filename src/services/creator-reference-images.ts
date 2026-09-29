import { parseApiId } from '@/lib/api-id'
import { validateCreatorReferenceImages } from '@/lib/creator-reference-images'
import { findCreatorAssetReference } from './creator-assets'

export class CreatorReferenceImageError extends Error {
    constructor(
        message: string,
        public status = 400
    ) {
        super(message)
    }
}

// Repeated image fields also accept the original single-image request format.
// Resolve ownership for every saved asset before writing files or admitting a job.
export async function readCreatorReferenceImages(form: FormData, userId: bigint) {
    const entries = form.getAll('image')
    if (entries.some(entry => !(entry instanceof File))) throw new CreatorReferenceImageError('参考图仅支持 JPG、PNG、WebP')
    const files = entries as File[]
    const assetIds = form.getAll('referenceAssetId').map(value => (typeof value === 'string' ? parseApiId(value.trim()) : null))
    const validationError = validateCreatorReferenceImages(files, assetIds.length)
    if (validationError) throw new CreatorReferenceImageError(validationError)
    const savedUrls: string[] = []
    for (const id of assetIds) {
        if (id === null) throw new CreatorReferenceImageError('参考作品 ID 无效')
        const asset = await findCreatorAssetReference(userId, id)
        if (!asset) throw new CreatorReferenceImageError('参考作品不存在', 404)
        if (!asset.referenceUrl) throw new CreatorReferenceImageError('该视频作品还没有可用封面，暂时不能作为参考图')
        savedUrls.push(asset.referenceUrl)
    }
    return { files, savedUrls, count: files.length + savedUrls.length }
}
