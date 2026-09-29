import { localMediaFilePath, localMediaKey } from './local-media'
import { localFetch } from '@/lib/local-fetch'
import Ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { clearEpisodeMergedVideoInTransaction, lockStoryboardMediaInTransaction, StaleStoryboardMutationError } from './artifacts'
import { mergeEpisodeSubtitles, SUBTITLE_LANGUAGES } from './subtitle'
import { saveLocalMediaFile } from './local-media'
import { parseNovelSetup } from '@/lib/novel'
import { ffmpegRuntimeConfig } from '@/lib/media-worker-config'
import { withFfmpegClusterSlot } from '@/lib/ffmpeg-workload-limit'
import { observeFfmpegOperation, type FfmpegOperation } from '@/lib/media-worker-metrics'

function configureFfmpegBinaries() {
    const ffmpegCandidates = [process.env.FFMPEG_PATH, process.env.FFMPEG_BIN, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].filter(Boolean) as string[]
    const ffprobeCandidates = [process.env.FFPROBE_PATH, process.env.FFPROBE_BIN, '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'].filter(Boolean) as string[]
    const ffmpegPath = ffmpegCandidates.find(candidate => fsSync.existsSync(candidate))
    const ffprobePath = ffprobeCandidates.find(candidate => fsSync.existsSync(candidate))
    if (ffmpegPath) Ffmpeg.setFfmpegPath(ffmpegPath)
    if (ffprobePath) Ffmpeg.setFfprobePath(ffprobePath)
}

configureFfmpegBinaries()

// FFmpeg 是本机最重的 CPU 任务，不能沿用图片/视频 API 的 5 路并发。
// 本机默认单路执行；CPU 密集任务还会获取一个数据库租约，限制集群总并发。
const FFMPEG_CONFIG = ffmpegRuntimeConfig()
const FFMPEG_CONCURRENCY = FFMPEG_CONFIG.concurrency
const FFMPEG_VIDEO_ENCODE_OPTIONS = [`-threads:v ${FFMPEG_CONFIG.threads}`, `-filter_threads ${FFMPEG_CONFIG.threads}`]
let activeFfmpegJobs = 0
const ffmpegWaiters: Array<() => void> = []

function grantNextFfmpegSlot() {
    const next = ffmpegWaiters.shift()
    if (!next) return
    activeFfmpegJobs += 1
    next()
}

async function acquireFfmpegSlot(): Promise<() => void> {
    if (activeFfmpegJobs < FFMPEG_CONCURRENCY) {
        activeFfmpegJobs += 1
        return () => {
            activeFfmpegJobs = Math.max(0, activeFfmpegJobs - 1)
            grantNextFfmpegSlot()
        }
    }
    return new Promise(resolve => {
        ffmpegWaiters.push(() => {
            resolve(() => {
                activeFfmpegJobs = Math.max(0, activeFfmpegJobs - 1)
                grantNextFfmpegSlot()
            })
        })
    })
}

export async function withFfmpegSlot<T>(work: () => Promise<T>): Promise<T> {
    const release = await acquireFfmpegSlot()
    try {
        return await work()
    } finally {
        release()
    }
}

async function withHeavyFfmpegSlot<T>(operation: FfmpegOperation, work: () => Promise<T>, succeeded?: (result: T) => boolean): Promise<T> {
    return withFfmpegSlot(() => withFfmpegClusterSlot(() => observeFfmpegOperation(operation, work, succeeded)))
}

function absPath(relPath: string) {
    return path.join(process.cwd(), 'public', relPath)
}

function storageAbsPath(filename: string) {
    return path.join(process.cwd(), 'public', 'storage', filename)
}

async function resolveMediaPath(value: string) {
    if (localMediaKey(value)) return localMediaFilePath(value)
    if (value.startsWith('/storage/')) return absPath(value)
    return path.isAbsolute(value) ? value : absPath(value)
}

/** 读取本地媒体时长；生成流程在上传前使用它拦截 0 秒文件。 */
export async function probeDuration(filePath: string): Promise<number> {
    return new Promise(resolve => {
        Ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return resolve(0)
            const formatDuration = Number(metadata.format.duration ?? 0)
            const streamDurations = (metadata.streams ?? []).map(stream => Number(stream.duration ?? 0)).filter(Number.isFinite)
            resolve(Math.max(formatDuration, ...streamDurations, 0))
        })
    })
}

export async function probeMediaStreams(filePath: string): Promise<{ hasVideo: boolean; hasAudio: boolean; duration: number }> {
    return new Promise(resolve => {
        Ffmpeg.ffprobe(filePath, (error, metadata) => {
            if (error) return resolve({ hasVideo: false, hasAudio: false, duration: 0 })
            const streams = metadata.streams ?? []
            const formatDuration = Number(metadata.format.duration ?? 0)
            const streamDurations = streams.map(stream => Number(stream.duration ?? 0)).filter(Number.isFinite)
            resolve({
                hasVideo: streams.some(stream => stream.codec_type === 'video'),
                hasAudio: streams.some(stream => stream.codec_type === 'audio'),
                duration: Math.max(formatDuration, ...streamDurations, 0)
            })
        })
    })
}

export type VideoValidationResult = {
    index: number
    path: string
    valid: boolean
    size: number
    duration: number
    reason?: string
}

/**
 * 合并前检查每个分镜成片，避免把不存在、空文件或 0 秒视频交给 concat。
 * ffprobe 属于 CPU/IO 操作，最多并发 5 个，和生成/取消任务保持一致。
 */
export async function validateVideoSegments(videoPaths: string[]): Promise<VideoValidationResult[]> {
    const results: VideoValidationResult[] = []
    for (let offset = 0; offset < videoPaths.length; offset += 5) {
        const batch = videoPaths.slice(offset, offset + 5)
        const checked = await Promise.all(
            batch.map(async (videoPath, batchIndex) => {
                const index = offset + batchIndex
                const filePath = localMediaKey(videoPath) ? await localMediaFilePath(videoPath) : isRemoteMediaPath(videoPath) ? videoPath : await resolveMediaPath(videoPath)
                let size = 0
                if (!isRemoteMediaPath(videoPath)) {
                    const stat = await fs.stat(filePath).catch(() => null)
                    size = stat?.size ?? 0
                    if (!stat) return { index, path: videoPath, valid: false, size, duration: 0, reason: '文件不存在' }
                    if (size < 1024) return { index, path: videoPath, valid: false, size, duration: 0, reason: '文件为空或损坏' }
                }
                const duration = await probeDuration(filePath)
                if (!Number.isFinite(duration) || duration <= 0.05) {
                    return { index, path: videoPath, valid: false, size, duration, reason: '视频时长为 0' }
                }
                return { index, path: videoPath, valid: true, size, duration }
            })
        )
        results.push(...checked)
    }
    return results
}

function isRemoteMediaPath(value: string) {
    return /^https?:\/\//i.test(value)
}

async function concatWithFallback(listFilePath: string, outputAbsPath: string, onProgress?: (frames: number) => void) {
    const run = (reencode: boolean) =>
        new Promise<void>((resolve, reject) => {
            const command = Ffmpeg()
                .input(listFilePath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions(
                    reencode
                        ? [
                              '-c:v libx264',
                              `-preset ${FFMPEG_CONFIG.preset}`,
                              '-crf 23',
                              ...FFMPEG_VIDEO_ENCODE_OPTIONS,
                              '-c:a aac',
                              '-b:a 192k',
                              '-fflags +genpts',
                              '-avoid_negative_ts make_zero',
                              '-movflags +faststart'
                          ]
                        : ['-c copy', '-fflags +genpts', '-avoid_negative_ts make_zero', '-movflags +faststart']
                )
                .output(outputAbsPath)
                .on('progress', progress => onProgress?.(Number(progress.frames ?? 0)))
                .on('end', () => resolve())
                .on('error', reject)
            command.run()
        })

    try {
        // 同编码、同分辨率的分片直接拼接，避免一次完整 H.264 重编码。
        await run(false)
    } catch (copyError) {
        await fs.unlink(outputAbsPath).catch(() => {})
        console.warn('[ffmpeg] stream-copy concat unavailable, falling back to re-encode:', copyError instanceof Error ? copyError.message : copyError)
        await run(true)
    }
}

async function validateEpisodeMergeOutput(filePath: string, expectedDuration: number): Promise<void> {
    const metadata = await new Promise<Ffmpeg.FfprobeData>((resolve, reject) => {
        Ffmpeg.ffprobe(filePath, (error, data) => (error ? reject(error) : resolve(data)))
    })
    const videoStream = metadata.streams?.find(stream => stream.codec_type === 'video')
    const audioStream = metadata.streams?.find(stream => stream.codec_type === 'audio')
    if (!videoStream) throw new Error('全集合并输出缺少视频轨')
    if (!audioStream) throw new Error('全集合并输出缺少音轨')

    const actualDuration = Number(metadata.format.duration ?? 0)
    const tolerance = Math.max(1, expectedDuration * 0.03)
    if (!Number.isFinite(actualDuration) || actualDuration <= 0.05 || Math.abs(actualDuration - expectedDuration) > tolerance) {
        throw new Error(`全集合并时间轴异常（输入总时长=${expectedDuration.toFixed(3)}s，输出=${actualDuration.toFixed(3)}s）`)
    }

    // ffprobe only confirms that an audio stream header exists. Decode both
    // streams with -xerror so corrupt AAC packets cannot be uploaded as a
    // seemingly successful episode.
    await new Promise<void>((resolve, reject) => {
        Ffmpeg(filePath)
            .outputOptions(['-map 0:v:0', '-map 0:a:0', '-xerror'])
            .format('null')
            .output('-')
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
}

async function materializeMediaPath(value: string, tempFiles: string[], fallbackExt: string): Promise<string> {
    if (localMediaKey(value)) return localMediaFilePath(value)
    if (!isRemoteMediaPath(value)) return resolveMediaPath(value)
    const response = await localFetch(value, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`媒体下载失败 ${response.status}: ${value.slice(0, 180)}`)
    const ext = path.extname(new URL(value).pathname) || fallbackExt
    const filename = `compose_input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    const localPath = storageAbsPath(filename)
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    await fs.writeFile(localPath, Buffer.from(await response.arrayBuffer()))
    tempFiles.push(localPath)
    return localPath
}

async function normalizeEpisodeSegment(inputPath: string, outputPath: string, targetWidth: number, targetHeight: number): Promise<void> {
    const metadata = await new Promise<Ffmpeg.FfprobeData>((resolve, reject) => {
        Ffmpeg.ffprobe(inputPath, (error, data) => (error ? reject(error) : resolve(data)))
    })
    const hasAudio = metadata.streams?.some(stream => stream.codec_type === 'audio') ?? false

    await new Promise<void>((resolve, reject) => {
        const command = Ffmpeg(inputPath)
        if (!hasAudio) {
            command.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi')
        }
        command
            .outputOptions([
                '-map 0:v:0',
                hasAudio ? '-map 0:a:0' : '-map 1:a:0',
                '-c:v libx264',
                `-preset ${FFMPEG_CONFIG.preset}`,
                '-crf 23',
                ...FFMPEG_VIDEO_ENCODE_OPTIONS,
                `-vf scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1`,
                '-c:a aac',
                '-b:a 192k',
                '-ar 44100',
                '-ac 2',
                '-shortest',
                '-fflags +genpts',
                '-avoid_negative_ts make_zero',
                '-movflags +faststart'
            ])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
}

export function resolveEpisodeTargetDimensions(dimensions: Array<{ width: number; height: number }>, aspectRatio: '9:16' | '16:9' | '1:1'): { width: number; height: number } {
    const valid = dimensions.filter(item => item.width >= 2 && item.height >= 2)
    const shortSides = valid.map(item => Math.max(2, Math.floor(Math.min(item.width, item.height) / 2) * 2))
    const frequencies = new Map<number, number>()
    for (const side of shortSides) frequencies.set(side, (frequencies.get(side) ?? 0) + 1)
    const mode = [...frequencies.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    const shortSide = mode && mode[1] > 1 ? mode[0] : Math.max(...shortSides, 720)
    if (aspectRatio === '1:1') return { width: shortSide, height: shortSide }
    if (aspectRatio === '16:9') return { width: Math.max(2, Math.floor((shortSide * 16) / 9 / 2) * 2), height: shortSide }
    return { width: shortSide, height: Math.max(2, Math.floor((shortSide * 16) / 9 / 2) * 2) }
}

export async function concatStorageVideos(inputRelPaths: string[], outputFilename: string): Promise<string> {
    if (inputRelPaths.length === 0) throw new Error('No video segments to concat')
    if (inputRelPaths.length === 1) return inputRelPaths[0]

    const safeOutputFilename = outputFilename.endsWith('.mp4') ? outputFilename : `${outputFilename}.mp4`
    const listFilePath = storageAbsPath(`concat_list_${path.basename(safeOutputFilename, '.mp4')}_${Date.now()}.txt`)
    const outputAbsPath = storageAbsPath(safeOutputFilename)
    const outputRelPath = `/storage/${safeOutputFilename}`

    const lines = inputRelPaths.map(p => `file '${absPath(p)}'`).join('\n')
    await fs.mkdir(path.dirname(listFilePath), { recursive: true })
    await fs.writeFile(listFilePath, lines)

    try {
        await withHeavyFfmpegSlot('concat', () => concatWithFallback(listFilePath, outputAbsPath))
    } finally {
        await fs.unlink(listFilePath).catch(() => {})
    }

    return outputRelPath
}

/** 将 MP4 的 moov 索引移动到文件头，支持浏览器边下边播。只复制音视频流，不重新编码。 */
export async function optimizeVideoForStreaming(inputPath: string): Promise<void> {
    const tempPath = `${inputPath}.faststart-${Date.now()}.mp4`
    try {
        await new Promise<void>((resolve, reject) => {
            Ffmpeg(inputPath)
                .outputOptions(['-c copy', '-movflags +faststart'])
                .output(tempPath)
                .on('end', () => resolve())
                .on('error', reject)
                .run()
        })
        const stat = await fs.stat(tempPath).catch(() => null)
        if (!stat || stat.size < 1024) throw new Error('faststart 输出为空')
        await fs.rename(tempPath, inputPath)
    } finally {
        await fs.unlink(tempPath).catch(() => {})
    }
}

/** Extract a display cover from a local video at the requested timestamp. */
export async function extractVideoCover(inputPath: string, outputPath: string, atSeconds = 0.5): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await new Promise<void>((resolve, reject) => {
        Ffmpeg(inputPath)
            .seekInput(Math.max(0, atSeconds))
            .outputOptions(['-vframes 1', '-q:v 2', '-update 1'])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
    const stat = await fs.stat(outputPath).catch(() => null)
    if (!stat || stat.size === 0) throw new Error('视频封面截取失败')
}

async function scoreFrameSharpness(framePath: string): Promise<number> {
    const samples: number[] = []
    await new Promise<void>((resolve, reject) => {
        Ffmpeg(framePath)
            .videoFilters(['edgedetect=low=0.05:high=0.2', 'signalstats', 'metadata=print:key=lavfi.signalstats.YAVG'])
            .outputOptions(['-f null'])
            .output('-')
            .on('stderr', line => {
                const match = line.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/)
                if (match) samples.push(Number(match[1]))
            })
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
    return samples.length ? Math.max(...samples) : 0
}

export const VIDEO_END_FRAME_OFFSETS = [0.1, 0.2, 0.3, 0.4, 0.5] as const

export function selectSharpestEndFrame<T extends { score: number }>(candidates: T[], minimumSharpness = 0.5): T | null {
    const best = candidates.reduce<T | null>((selected, candidate) => (!selected || candidate.score > selected.score ? candidate : selected), null)
    return best && best.score >= minimumSharpness ? best : null
}

// 从结尾 0.5 秒抽取多个候选帧，并按边缘清晰度择优。运动模糊严重时返回
// null，让调用方保留规划末图，不把过渡态传播到后续连续性链路。
export async function extractLastFrameFromVideo(videoRelPath: string): Promise<string | null> {
    if (!videoRelPath) return null
    const videoAbsPath = await resolveMediaPath(videoRelPath)
    try {
        await fs.access(videoAbsPath)
    } catch {
        return null
    }

    const candidatePaths: string[] = []
    try {
        const duration = await probeDuration(videoAbsPath)
        if (!Number.isFinite(duration) || duration <= 0.05) return null
        const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const offsets = VIDEO_END_FRAME_OFFSETS.filter(offset => offset < duration)
        const candidates: Array<{ path: string; score: number }> = []
        for (const [index, offset] of offsets.entries()) {
            const candidatePath = storageAbsPath(`video_end_candidate_${token}_${index}.jpg`)
            candidatePaths.push(candidatePath)
            await fs.mkdir(path.dirname(candidatePath), { recursive: true })
            await new Promise<void>((resolve, reject) => {
                Ffmpeg(videoAbsPath)
                    .seekInput(Math.max(0, duration - offset))
                    .outputOptions(['-vframes 1', '-q:v 2', '-update 1'])
                    .output(candidatePath)
                    .on('end', () => resolve())
                    .on('error', reject)
                    .run()
            })
            const stat = await fs.stat(candidatePath).catch(() => null)
            if (stat?.size) candidates.push({ path: candidatePath, score: await scoreFrameSharpness(candidatePath).catch(() => 0) })
        }
        const best = selectSharpestEndFrame(candidates)
        if (!best) return null
        const outputFilename = `video_end_frame_${token}.jpg`
        const outputAbsPath = storageAbsPath(outputFilename)
        await fs.rename(best.path, outputAbsPath)
        return `/storage/${outputFilename}`
    } catch (err) {
        console.warn('[ffmpeg] extractLastFrameFromVideo failed:', err instanceof Error ? err.message : err)
        return null
    } finally {
        await Promise.all(candidatePaths.map(candidatePath => fs.unlink(candidatePath).catch(() => {})))
    }
}

async function composeShotInternal(storyboardId: bigint, generationId?: bigint) {
    const generation = generationId ? await prisma.generation.findUnique({ where: { id: generationId }, select: { status: true, resourceVersion: true } }) : null
    const storyboard = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        include: { characters: { include: { character: true } } }
    })
    if (!storyboard) throw new Error('Storyboard not found')
    if (generationId && (!generation || generation.status !== 'processing' || generation.resourceVersion !== storyboard.operationVersion)) {
        return
    }
    if (!storyboard.videoUrl) throw new Error('Video not ready')

    const tempFiles: string[] = []
    try {
        const videoAbsPath = await materializeMediaPath(storyboard.videoUrl, tempFiles, '.mp4')
        const audioAbsPath = storyboard.audioUrl ? await materializeMediaPath(storyboard.audioUrl, tempFiles, '.mp3') : null
        const sourceVideoDuration = await probeDuration(videoAbsPath)
        if (sourceVideoDuration <= 0.05) throw new Error('输入视频无效：视频时长为 0')
        if (audioAbsPath) {
            const sourceAudioDuration = await probeDuration(audioAbsPath)
            if (sourceAudioDuration <= 0.05) throw new Error('输入外部音轨无效：音频时长为 0')
        }
        const outputFilename = `composed_${storyboardId}_${generationId ?? randomUUID()}.mp4`
        const outputAbsPath = storageAbsPath(outputFilename)

        // 探测视频是否本身带音轨（Seedance 的 generate_audio 会生成环境音）
        const videoHasAudio: boolean = await new Promise(resolve => {
            Ffmpeg.ffprobe(videoAbsPath, (err, metadata) => {
                if (err) return resolve(false)
                const hasAudio = (metadata.streams ?? []).some(s => s.codec_type === 'audio')
                resolve(hasAudio)
            })
        })

        await new Promise<void>((resolve, reject) => {
            const cmd = Ffmpeg(videoAbsPath)

            if (audioAbsPath) {
                cmd.input(audioAbsPath)
            }

            // 音轨合成策略：
            // - 视频带音 + 历史外部对白轨 → 压低原轨作为环境声底，再混入最终对白
            // - 视频带音，无外部对白轨   → 保留视频原音
            // - 视频不带音 + 外部对白轨   → 只用外部对白轨
            // - 视频不带音，也无对白轨   → 静音（-an）
            const hasExternalAudio = !!storyboard.audioUrl

            if (videoHasAudio && hasExternalAudio) {
                // 外部音轨是最终对白轨；原轨按 -11dB duck 后只保留氛围和拟音。
                cmd.complexFilter(['[0:a]volume=0.28[bed]', '[1:a]volume=1.0[voice]', '[bed][voice]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95[mix]'])
                cmd.outputOptions(['-map 0:v', '-map [mix]', '-c:v copy', '-c:a aac', '-b:a 192k', '-movflags +faststart', '-shortest'])
            } else if (videoHasAudio) {
                // 保留视频原音
                cmd.outputOptions(['-map 0:v', '-map 0:a', '-c copy', '-movflags +faststart'])
            } else if (hasExternalAudio) {
                // 只用历史外部对白轨
                cmd.outputOptions(['-map 0:v', '-map 1:a', '-c:v copy', '-c:a aac', '-movflags +faststart', '-shortest'])
            } else {
                // 没有外部音轨时只做封装，不重新编码视频。
                cmd.outputOptions(['-map 0:v', '-c copy', '-movflags +faststart'])
            }

            cmd.output(outputAbsPath)
                .on('end', () => resolve())
                .on('error', reject)
                .run()
        })

        const outputStat = await fs.stat(outputAbsPath).catch(() => null)
        const outputDuration = await probeDuration(outputAbsPath)
        if (!outputStat || outputStat.size < 1024 || outputDuration <= 0.05) {
            throw new Error(`FFmpeg 输出文件无效（size=${outputStat?.size ?? 0}, duration=${outputDuration.toFixed(3)}s）`)
        }

        // 线上容器不是共享持久盘，不能把 /storage 本地路径写入数据库。
        // 合成完成后保存到本地素材目录，前端通过本机媒体路由读取。
        const publicVideoUrl = await saveLocalMediaFile(outputAbsPath, `videos/storyboards/${storyboardId}`, outputFilename)
        await prisma.$transaction(async tx => {
            await lockStoryboardMediaInTransaction(tx, storyboard)
            if (generationId) {
                const active = await tx.generation.findFirst({ where: { id: generationId, status: 'processing', resourceVersion: storyboard.operationVersion }, select: { id: true } })
                if (!active) throw new StaleStoryboardMutationError()
            }
            await tx.storyboard.updateMany({
                where: { id: storyboardId, deletedAt: null, operationVersion: storyboard.operationVersion },
                data: {
                    composedVideoUrl: publicVideoUrl,
                    composeStatus: 'completed',
                    compositionMode: videoHasAudio && storyboard.audioUrl ? 'audio_mix' : storyboard.audioUrl ? 'audio_replace' : 'passthrough'
                }
            })
            if (generationId) {
                await tx.generation.updateMany({
                    where: { id: generationId, status: 'processing', resourceVersion: storyboard.operationVersion },
                    data: {
                        status: 'completed',
                        activeKey: null,
                        resultUrl: publicVideoUrl,
                        compositionMode: videoHasAudio && storyboard.audioUrl ? 'audio_mix' : storyboard.audioUrl ? 'audio_replace' : 'passthrough',
                        metrics: {
                            videoHadAudio: videoHasAudio,
                            dialogueGain: storyboard.audioUrl ? 1 : null,
                            sourceAudioGain: videoHasAudio && storyboard.audioUrl ? 0.28 : videoHasAudio ? 1 : 0
                        }
                    }
                })
            }
            await clearEpisodeMergedVideoInTransaction(tx, storyboard.episodeId)
        })
        await fs.unlink(outputAbsPath).catch(() => {})
    } catch (err) {
        if (err instanceof StaleStoryboardMutationError) return
        const rawMessage = err instanceof Error ? err.message : String(err)
        const msg = /cannot find ffmpeg|ffmpeg not found/i.test(rawMessage) ? '服务器未找到 FFmpeg。请安装 ffmpeg/ffprobe，或配置 FFMPEG_PATH 和 FFPROBE_PATH 环境变量。' : rawMessage
        await prisma.storyboard.updateMany({
            where: { id: storyboardId, deletedAt: null, operationVersion: storyboard.operationVersion },
            data: { composeStatus: 'failed' }
        })
        if (generationId) {
            await prisma.generation.updateMany({
                where: { id: generationId, status: 'processing', resourceVersion: storyboard.operationVersion },
                data: { status: 'failed', activeKey: null, errorMsg: msg }
            })
        }
        throw new Error(msg)
    } finally {
        await Promise.all(tempFiles.map(file => fs.unlink(file).catch(() => {})))
    }
}

// 单镜头合成：视频 + 音频。字幕文件独立生成，不烧录到视频。
export async function composeShot(storyboardId: bigint, generationId?: bigint) {
    return withHeavyFfmpegSlot('compose', () => composeShotInternal(storyboardId, generationId))
}

/**
 * Seedance multi-keyframe clips are generated without per-segment audio to
 * avoid audible cuts. Add one quiet continuous room-tone bed only after the
 * visual segments have been concatenated.
 */
export async function addContinuousAmbientBedToVideo(inputRelPath: string, outputRelPath: string) {
    const inputAbsPath = storageAbsPath(path.basename(inputRelPath))
    const outputAbsPath = storageAbsPath(path.basename(outputRelPath))
    const duration = await probeDuration(inputAbsPath)
    if (!Number.isFinite(duration) || duration <= 0.05) throw new Error('无法为无效视频生成连续环境声')
    await new Promise<void>((resolve, reject) => {
        Ffmpeg(inputAbsPath)
            .input(`anoisesrc=color=pink:amplitude=0.004:sample_rate=48000:d=${duration.toFixed(3)}`)
            .inputFormat('lavfi')
            .complexFilter(['[1:a]highpass=f=70,lowpass=f=4200,afade=t=in:st=0:d=0.35[ambient]'])
            .outputOptions(['-map 0:v', '-map [ambient]', '-c:v copy', '-c:a aac', '-b:a 128k', '-shortest', '-movflags +faststart'])
            .output(outputAbsPath)
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
    return outputRelPath
}

// 全集视频合并
async function mergeEpisodeVideosInternal(episodeId: bigint, mergeId: bigint, composedVideoPaths: string[]) {
    const mergeSnapshot = await prisma.videoMerge.findUnique({ where: { id: mergeId }, select: { status: true, resourceVersion: true } })
    const episodeSnapshot = await prisma.episode.findUnique({ where: { id: episodeId }, select: { operationVersion: true, deletedAt: true } })
    if (!mergeSnapshot || mergeSnapshot.status !== 'processing' || !episodeSnapshot || episodeSnapshot.deletedAt || mergeSnapshot.resourceVersion !== episodeSnapshot.operationVersion) {
        return { success: false as const, error: '合并任务已取消或资源版本已变化' }
    }
    const tempFiles: string[] = []
    try {
        // 单镜头合成产物保存在本机；合并时读取素材副本，完成后清理临时文件。
        const localVideoPaths: string[] = []
        for (let offset = 0; offset < composedVideoPaths.length; offset += 5) {
            const batch = composedVideoPaths.slice(offset, offset + 5)
            localVideoPaths.push(...(await Promise.all(batch.map(p => materializeMediaPath(p, tempFiles, '.mp4')))))
        }
        const localValidation = await validateVideoSegments(localVideoPaths)
        const invalidLocal = localValidation.filter(item => !item.valid)
        if (invalidLocal.length > 0) {
            throw new Error(`分镜视频下载后校验失败：${invalidLocal.map(item => `第${item.index + 1}个（${item.reason}）`).join('、')}`)
        }

        const [metadataRows, episodeProject] = await Promise.all([
            Promise.all(
                localVideoPaths.map(
                    videoPath =>
                        new Promise<Ffmpeg.FfprobeData>((resolve, reject) => {
                            Ffmpeg.ffprobe(videoPath, (error, data) => (error ? reject(error) : resolve(data)))
                        })
                )
            ),
            prisma.episode.findUnique({
                where: { id: episodeId },
                select: { project: { select: { novelSetup: true } }, storyboards: { where: { deletedAt: null }, select: { dialogue: true } } }
            })
        ])
        const configuredRatio = parseNovelSetup(episodeProject?.project.novelSetup).videoAspectRatio
        const aspectRatio = configuredRatio === '16:9' || configuredRatio === '1:1' ? configuredRatio : '9:16'
        const target = resolveEpisodeTargetDimensions(
            metadataRows.map(metadata => {
                const stream = metadata.streams?.find(item => item.codec_type === 'video')
                return { width: Number(stream?.width ?? 0), height: Number(stream?.height ?? 0) }
            }),
            aspectRatio
        )
        const targetWidth = target.width
        const targetHeight = target.height

        // The concat demuxer applies the first segment's codec timing metadata
        // to later segments. Decode each clip independently first so mixed
        // 24/30 fps and 24/44.1 kHz sources cannot corrupt the final timeline.
        const normalizedVideoPaths: string[] = []
        for (let index = 0; index < localVideoPaths.length; index += 1) {
            const normalizedPath = storageAbsPath(`merge_normalized_${mergeId}_${index}.mp4`)
            tempFiles.push(normalizedPath)
            await normalizeEpisodeSegment(localVideoPaths[index], normalizedPath, targetWidth, targetHeight)
            normalizedVideoPaths.push(normalizedPath)
        }

        const listFilePath = storageAbsPath(`merge_list_${mergeId}.txt`)
        const outputFilename = `episode_${episodeId}_${mergeId}.mp4`
        const outputAbsPath = storageAbsPath(outputFilename)

        // 生成 concat 列表文件
        const lines = normalizedVideoPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
        await fs.mkdir(path.dirname(listFilePath), { recursive: true })
        await fs.writeFile(listFilePath, lines)

        // ffprobe 每个分片，聚合总帧数用于进度节流（进度字段已不再存到 DB）
        const totalShots = normalizedVideoPaths.length

        const frameCounts = await Promise.all(
            normalizedVideoPaths.map(
                p =>
                    new Promise<number>(resolve => {
                        Ffmpeg.ffprobe(p, (err, meta) => {
                            if (err) return resolve(0)
                            const stream = meta.streams?.find(s => s.codec_type === 'video')
                            const frames = stream?.nb_frames ? parseInt(stream.nb_frames, 10) : 0
                            if (frames > 0) return resolve(frames)
                            // nb_frames 可能缺失，用时长×帧率估算
                            const dur = meta.format.duration ?? 0
                            const fps = stream?.r_frame_rate
                                ? (() => {
                                      const [n, d] = stream.r_frame_rate!.split('/').map(Number)
                                      return d ? n / d : 24
                                  })()
                                : 24
                            resolve(Math.round(dur * fps))
                        })
                    })
            )
        )
        const totalFrames = frameCounts.reduce((a, b) => a + b, 0) || 0
        void totalShots

        let lastWrittenPct = 0
        await concatWithFallback(listFilePath, outputAbsPath, frames => {
            if (totalFrames <= 0) return
            const pct = Math.min(99, Math.round((frames / totalFrames) * 100))
            if (pct - lastWrittenPct < 3) return // 每 3% 更新一次进度节流阈值
            lastWrittenPct = pct
        })

        // 获取时长
        const duration = await probeDuration(outputAbsPath)
        const normalizedDurations = await Promise.all(normalizedVideoPaths.map(p => probeDuration(p)))
        const inputDurationSum = normalizedDurations.reduce((sum, value) => sum + value, 0)
        const resolvedDuration = duration > 0 ? duration : inputDurationSum
        const outputStat = await fs.stat(outputAbsPath).catch(() => null)
        if (!outputStat || outputStat.size < 1024 || resolvedDuration <= 0.05) {
            throw new Error(`全集合并输出无效（size=${outputStat?.size ?? 0}, duration=${resolvedDuration.toFixed(3)}s）`)
        }
        await validateEpisodeMergeOutput(outputAbsPath, inputDurationSum)

        await fs.unlink(listFilePath).catch(() => {})

        let subtitleUrls: Partial<Record<string, string>> = {}
        try {
            // 在标记全集合并完成前生成字幕文件，避免前端先看到完成但字幕链接还没落库。
            subtitleUrls = await mergeEpisodeSubtitles(episodeId, normalizedDurations, resolvedDuration)
        } catch (subtitleError) {
            console.warn('[subtitle] episode subtitle merge failed:', subtitleError instanceof Error ? subtitleError.message : subtitleError)
        }

        const publicVideoUrl = await saveLocalMediaFile(outputAbsPath, `videos/episodes/${episodeId}`, outputFilename)
        const hasDialogue = episodeProject?.storyboards.some(storyboard => storyboard.dialogue?.trim()) ?? false
        const expectedSubtitleLanguages = hasDialogue ? SUBTITLE_LANGUAGES.map(language => language.code) : []
        const completedSubtitleLanguages = expectedSubtitleLanguages.filter(language => !!subtitleUrls[language])
        const failedSubtitleLanguages = expectedSubtitleLanguages.filter(language => !subtitleUrls[language])
        const subtitleStatus = !hasDialogue ? 'not_required' : failedSubtitleLanguages.length === 0 ? 'completed' : completedSubtitleLanguages.length > 0 ? 'partial' : 'failed'
        const subtitleProgress = {
            expected: expectedSubtitleLanguages,
            completed: completedSubtitleLanguages,
            failed: failedSubtitleLanguages,
            timelineDurations: normalizedDurations
        }

        await prisma.$transaction(async tx => {
            try {
                const completed = await tx.videoMerge.updateMany({
                    where: { id: mergeId, status: 'processing', resourceVersion: episodeSnapshot.operationVersion },
                    data: {
                        status: 'completed',
                        videoStatus: 'completed',
                        subtitleStatus,
                        subtitleProgress,
                        targetWidth,
                        targetHeight,
                        activeKey: null,
                        videoUrl: publicVideoUrl,
                        duration: resolvedDuration,
                        subtitleUrls: JSON.stringify(subtitleUrls)
                    }
                })
                if (completed.count !== 1) throw new Error('合并任务已取消，旧结果未写入')
            } catch (updateError) {
                // 兼容 migration 尚未执行的旧容器：视频仍可完成，字幕链接待迁移后补写。
                if (!/subtitle_urls|unknown column|does not exist/i.test(updateError instanceof Error ? updateError.message : String(updateError))) throw updateError
                const completed = await tx.videoMerge.updateMany({
                    where: { id: mergeId, status: 'processing', resourceVersion: episodeSnapshot.operationVersion },
                    data: {
                        status: 'completed',
                        videoStatus: 'completed',
                        subtitleStatus,
                        subtitleProgress,
                        targetWidth,
                        targetHeight,
                        activeKey: null,
                        videoUrl: publicVideoUrl,
                        duration: resolvedDuration
                    }
                })
                if (completed.count !== 1) throw new Error('合并任务已取消，旧结果未写入')
            }
            const applied = await tx.episode.updateMany({
                where: { id: episodeId, deletedAt: null, operationVersion: episodeSnapshot.operationVersion },
                data: { videoUrl: publicVideoUrl, status: 'completed' }
            })
            if (applied.count !== 1) throw new Error('剧集已被修改，旧合并结果已丢弃')
        })
        await fs.unlink(outputAbsPath).catch(() => {})
        return { success: true as const, duration: resolvedDuration }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await prisma.videoMerge.updateMany({
            where: { id: mergeId, status: 'processing' },
            data: { status: 'failed', videoStatus: 'failed', activeKey: null, errorMsg: msg }
        })
        return { success: false as const, error: msg }
    } finally {
        await Promise.all(tempFiles.map(file => fs.unlink(file).catch(() => {})))
    }
}

// 全集合并同样受 FFmpeg 并发限制，避免与单镜头合成同时把 CPU 打满。
export async function mergeEpisodeVideos(episodeId: bigint, mergeId: bigint, composedVideoPaths: string[]) {
    return withHeavyFfmpegSlot(
        'episode_merge',
        () => mergeEpisodeVideosInternal(episodeId, mergeId, composedVideoPaths),
        result => result.success
    )
}
