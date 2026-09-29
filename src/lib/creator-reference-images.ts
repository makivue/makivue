export const MAX_CREATOR_REFERENCE_IMAGES = 3
export const MAX_CREATOR_IMAGE_BYTES = 10 * 1024 * 1024
export const CREATOR_IMAGE_EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
}

export function validateCreatorReferenceImages(files: readonly File[], savedCount = 0): string | null {
    if (files.length + savedCount > MAX_CREATOR_REFERENCE_IMAGES) return '最多上传 3 张参考图片'
    if (files.some(file => !Object.hasOwn(CREATOR_IMAGE_EXTENSIONS, file.type) || file.size === 0)) return '参考图仅支持 JPG、PNG、WebP'
    if (files.some(file => file.size > MAX_CREATOR_IMAGE_BYTES)) return '参考图不能超过 10MB'
    return null
}

export function creatorReferenceLimitMessage(count: number) {
    if (count === 0) return '当前仅支持文字生成视频，请移除参考图'
    return `当前模型最多支持 ${count} 份参考素材，请减少素材或更换模型。`
}
