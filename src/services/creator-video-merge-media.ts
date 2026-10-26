import Ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ffmpegRuntimeConfig } from '@/lib/media-worker-config'
import { probeMediaStreams, withFfmpegSlot } from './ffmpeg'
import type { CreatorMergeRatio } from '@/lib/creator-video-merge'

const ffmpegBinary = [process.env.FFMPEG_PATH, process.env.FFMPEG_BIN, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(candidate => candidate && existsSync(candidate)) || 'ffmpeg'

/** Normalize each clip independently so mixed sizes and missing audio concatenate safely. */
export async function mergeCreatorClips(inputPaths: string[], outputPath: string, ratio: CreatorMergeRatio, onProgress: (completed: number) => Promise<void>) {
    return withFfmpegSlot(async () => {
        const config = ffmpegRuntimeConfig()
        const media = await Promise.all(inputPaths.map(probeMediaStreams))
        if (media.some(item => !item.hasVideo || item.duration <= 0.05)) throw new Error('拼接片段包含损坏或空视频')
        const expectedDuration = media.reduce((sum, item) => sum + item.duration, 0)
        if (expectedDuration > 600) throw new Error('拼接总时长不能超过 10 分钟')
        const metadata = await new Promise<Ffmpeg.FfprobeData>((resolve, reject) => {
            Ffmpeg.ffprobe(inputPaths[0], (error, data) => error ? reject(error) : resolve(data))
        })
        const video = metadata.streams.find(stream => stream.codec_type === 'video')
        if (!video?.width || !video.height) throw new Error('视频尺寸无效')
        const side = Math.min(1080, Math.max(2, Math.floor(Math.min(video.width, video.height) / 2) * 2))
        const [rw, rh] = ratio.split(':').map(Number)
        const width = Math.max(2, Math.floor((rw >= rh ? side * rw / rh : side) / 2) * 2)
        const height = Math.max(2, Math.floor((rw >= rh ? side : side * rh / rw) / 2) * 2)
        const normalized: string[] = []
        const listPath = `${outputPath}.txt`
        try {
            for (const [index, input] of inputPaths.entries()) {
                const destination = `${outputPath}.${index}.mp4`
                normalized.push(destination)
                // Recent FFmpeg versions list lavfi as a device, which fluent-ffmpeg's
                // format capability parser cannot recognize. Pass argument arrays directly.
                await promisify(execFile)(ffmpegBinary, [
                    '-y', '-v', 'error', '-i', input,
                    ...(!media[index].hasAudio ? ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'] : []),
                    '-map', '0:v:0', '-map', media[index].hasAudio ? '0:a:0' : '1:a:0',
                    '-c:v', 'libx264', '-preset', config.preset, '-crf', '23',
                    '-threads:v', String(config.threads), '-filter_threads', String(config.threads),
                    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1`,
                    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
                    '-af', 'apad', '-t', String(media[index].duration), '-fflags', '+genpts', '-movflags', '+faststart', destination
                ], { timeout: 30 * 60_000, maxBuffer: 1024 * 1024 })
                await onProgress(index + 1)
            }
            await fs.writeFile(listPath, normalized.map(value => `file '${value.replace(/'/g, "'\\''")}'`).join('\n'))
            await new Promise<void>((resolve, reject) => {
                Ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-fflags +genpts', '-movflags +faststart'])
                    .output(outputPath).on('end', () => resolve()).on('error', reject).run()
            })
            const output = await probeMediaStreams(outputPath)
            if (!output.hasVideo || !output.hasAudio || Math.abs(output.duration - expectedDuration) > Math.max(1, expectedDuration * 0.03)) throw new Error('拼接结果时长或音视频轨异常')
            await new Promise<void>((resolve, reject) => {
                Ffmpeg(outputPath).outputOptions(['-map 0:v:0', '-map 0:a:0', '-xerror'])
                    .format('null').output('-').on('end', () => resolve()).on('error', reject).run()
            })
            return output.duration
        } finally {
            await Promise.all([...normalized, listPath].map(file => fs.unlink(file).catch(() => {})))
        }
    })
}
