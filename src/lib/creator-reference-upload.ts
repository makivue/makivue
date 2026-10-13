// Match Wan's server-side reference preparation before sending the multipart
// body through the gateway. Keep the selected originals for previews/reuse.
const MAX_WAN_REFERENCE_EDGE = 2048
const preparedUploads = new WeakMap<File, Promise<File>>()

async function prepareWanReferenceUpload(file: File): Promise<File> {
    let bitmap: ImageBitmap | undefined
    let canvas: HTMLCanvasElement | undefined
    try {
        bitmap = await createImageBitmap(file)
        const scale = Math.min(1, MAX_WAN_REFERENCE_EDGE / Math.max(bitmap.width, bitmap.height))
        canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d')
        if (!context) return file
        context.imageSmoothingQuality = 'high'
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const outputCanvas = canvas
        const blob = await new Promise<Blob | null>(resolve => outputCanvas.toBlob(resolve, 'image/jpeg', 0.9))
        if (!blob || blob.size === 0 || blob.size >= file.size) return file
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
    } catch {
        // Older browsers and unsupported images retain the existing server path.
        return file
    } finally {
        bitmap?.close()
        if (canvas) canvas.width = canvas.height = 0
    }
}

export async function prepareCreatorReferenceUploads(files: readonly File[], provider: string): Promise<File[]> {
    if (provider !== 'wan3' && provider !== 'wan3prime') return [...files]
    const uploads: File[] = []
    // Decode one image at a time to bound memory when three large PNGs are used.
    for (const file of files) {
        let prepared = preparedUploads.get(file)
        if (!prepared) {
            prepared = prepareWanReferenceUpload(file)
            preparedUploads.set(file, prepared)
        }
        uploads.push(await prepared)
    }
    return uploads
}
