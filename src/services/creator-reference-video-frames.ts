import { localFetch } from '@/lib/local-fetch'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { QWEN_IMAGE_MAX_REFERENCES } from '@/lib/provider-capabilities'
import { MAX_REFERENCE_VIDEO_BYTES, type StoryboardReferenceVideo } from '@/lib/storyboard-reference-videos'
import { extractVideoCover, probeMediaStreams, withFfmpegSlot } from './ffmpeg'

/** The caller validates ownership before passing an uploaded creator video. */
export async function withCreatorReferenceVideoFrames<T>(video: StoryboardReferenceVideo | undefined, referenceImages: string[], run: (images: string[]) => Promise<T>): Promise<T> {
    if (!video) return run(referenceImages)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-creator-video-frames-'))
    try {
        const response = await localFetch(video.url, { signal: AbortSignal.timeout(120_000), redirect: 'error' })
        if (!response.ok || !response.body) throw new Error('参考视频下载失败，请重新上传')
        const videoPath = path.join(tempDir, 'reference-video')
        let bytes = 0
        const sizeLimit = new Transform({
            transform(chunk, _encoding, callback) {
                bytes += chunk.length
                callback(bytes > MAX_REFERENCE_VIDEO_BYTES ? new Error('参考视频最大 300MB') : null, chunk)
            }
        })
        await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), sizeLimit, createWriteStream(videoPath))
        const frames = await withFfmpegSlot(async () => {
            const media = await probeMediaStreams(videoPath)
            if (!media.hasVideo || !Number.isFinite(media.duration) || media.duration <= 0.05) throw new Error('参考视频无效或时长为 0')
            // Stay within every supported image model's budget, including Qwen.
            const count = Math.max(1, QWEN_IMAGE_MAX_REFERENCES - referenceImages.length)
            const sampled: string[] = []
            for (let index = 0; index < count; index++) {
                const framePath = path.join(tempDir, `frame-${index}.jpg`)
                await extractVideoCover(videoPath, framePath, (media.duration * index) / count)
                sampled.push(framePath)
            }
            return sampled
        })
        return await run([...referenceImages, ...frames])
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
    }
}
