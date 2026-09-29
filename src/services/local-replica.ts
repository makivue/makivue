import 'server-only'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Ffmpeg from 'fluent-ffmpeg'
import { jsonrepair } from 'jsonrepair'
import type { ReplicaData } from '@/lib/replica-jobs'
import { localMediaFilePath, localMediaKey, saveLocalMediaFile } from './local-media'
import { localFetch } from '@/lib/local-fetch'
import { probeDuration, withFfmpegSlot } from './ffmpeg'
import { getDashScopeConfig } from './dashscope-config'
import { getSeedanceConfig } from './seedance-config'
import { WAN_3_MODEL, WAN_3_PRIME_MODEL, WAN_3_RESOLUTION } from '@/lib/provider-capabilities'

async function sourceVideo(data: ReplicaData): Promise<string> {
    const url = String(data.payload.videoUrl || data.payload.videoFile || '')
    if (localMediaKey(url)) return localMediaFilePath(url)
    // Uploaded workspace media is required; no server-side arbitrary URL retrieval.
    throw new Error('请先上传参考视频到本地工作区，再提交分析或复刻')
}
async function ffmpegOutput(command: Ffmpeg.FfmpegCommand, output: string) {
    await withFfmpegSlot(
        () =>
            new Promise<void>((resolve, reject) =>
                command
                    .output(output)
                    .on('end', () => resolve())
                    .on('error', reject)
                    .run()
            )
    )
}
async function videoConfig(provider: string) {
    const wan = provider === 'wan3' || provider === 'wan3prime'
    if (!wan && provider !== 'seedance' && provider !== 'seedance25') throw new Error('不支持的视频模型')
    const config = wan ? getDashScopeConfig() : await getSeedanceConfig(provider as 'seedance' | 'seedance25')
    if (!config?.apiKey) throw new Error('请在 .env 配置所选视频模型的个人密钥')
    return {
        wan,
        key: config.apiKey,
        base: String(config.baseUrl || (wan ? 'https://dashscope.aliyuncs.com' : 'https://ark.cn-beijing.volces.com')).replace(/\/$/, ''),
        model: wan ? (provider === 'wan3prime' ? WAN_3_PRIME_MODEL : WAN_3_MODEL) : config.modelName
    }
}
export async function runLocalReplica(taskId: string, data: ReplicaData): Promise<ReplicaData> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-replica-'))
    try {
        const video = await sourceVideo(data)
        const duration = await probeDuration(video)
        if (duration <= 0 || duration > 600) throw new Error('参考视频需为 10 分钟以内的有效视频')
        const images = []
        for (let index = 0; index < 8; index++) {
            const time = Math.min(duration - 0.05, (duration * index) / 8)
            const frame = path.join(directory, `${index}.jpg`)
            await ffmpegOutput(Ffmpeg(video).seekInput(Math.max(0, time)).frames(1).size('768x?'), frame)
            images.push(
                { type: 'text', text: `Frame at ${time.toFixed(2)} seconds` },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${(await fs.readFile(frame)).toString('base64')}` } }
            )
        }
        const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '').replace(/\/v1$/, '')
        const response = await localFetch(`${base}/v1/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(180_000),
            body: JSON.stringify({
                model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Analyze these sampled frames from a ${duration.toFixed(2)} second video. Do not claim to hear audio. Return JSON with summary, script, prompt (video generation prompt with dialogue/native audio if appropriate), clips (1-5 objects with start and end seconds within the source duration). Language: ${String(data.payload.language || data.payload.targetLanguage || 'zh')}. New topic: ${String(data.payload.topic || 'Preserve the visual theme')}. Clip budget: ${Number(data.payload.maxClipDuration) || 30} seconds. Do not invent verbatim subtitles from silent frames.`
                            },
                            ...images
                        ]
                    }
                ],
                response_format: { type: 'json_object' }
            })
        })
        if (!response.ok) throw new Error(`视觉模型请求失败（HTTP ${response.status}）`)
        const result = await response.json()
        const output = JSON.parse(jsonrepair(String(result.choices?.[0]?.message?.content || '{}'))) as Record<string, unknown>
        if (typeof output.summary !== 'string') throw new Error('视觉模型未返回有效分析')
        const next: ReplicaData = { ...data, output: { ...output, analysisMethod: '8 sampled frames; audio was not transcribed', sourceDuration: duration } }
        if (data.mode === 'analyze') return next
        if (data.mode === 'clip') {
            const budget = Math.max(1, Math.min(duration, Number(data.payload.maxClipDuration) || 30))
            const clips = Array.isArray(output.clips) ? output.clips : []
            let remaining = budget
            const files: string[] = []
            for (const item of clips.slice(0, 5)) {
                const start = Math.max(0, Number(item.start)),
                    end = Math.min(duration, Number(item.end))
                const length = Math.min(end - start, remaining)
                if (!Number.isFinite(length) || length < 0.1) continue
                const file = path.join(directory, `clip-${files.length}.mp4`)
                await ffmpegOutput(Ffmpeg(video).seekInput(start).duration(length).outputOptions(['-c:v libx264', '-preset veryfast', '-c:a aac', '-movflags +faststart']), file)
                remaining -= length
                files.push(file)
            }
            if (!files.length) throw new Error('模型未给出有效剪辑时间段，请重试')
            const list = path.join(directory, 'concat.txt'),
                final = path.join(directory, 'result.mp4')
            await fs.writeFile(list, files.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'))
            await ffmpegOutput(Ffmpeg(list).inputOptions(['-f concat', '-safe 0']).outputOptions(['-c copy', '-movflags +faststart']), final)
            next.output!.videoUrl = await saveLocalMediaFile(final, `replica/${taskId}`, 'clip.mp4')
            return next
        }
        const provider = String(data.payload.videoProvider || 'seedance25'),
            config = await videoConfig(provider)
        const prompt = String(output.prompt || output.script || output.summary).slice(0, 4000)
        const ratio = ['9:16', '16:9', '1:1'].includes(String(data.payload.aspectRatio)) ? String(data.payload.aspectRatio) : '9:16'
        const durationSeconds = Number(data.payload.videoDuration) || 5
        const body = config.wan
            ? { model: config.model, input: { prompt }, parameters: { resolution: WAN_3_RESOLUTION, ratio, duration: durationSeconds } }
            : { model: config.model, content: [{ type: 'text', text: prompt }], ratio, duration: durationSeconds, generate_audio: true, watermark: false }
        const created = await localFetch(`${config.base}${config.wan ? '/api/v1/services/aigc/video-generation/video-synthesis' : '/api/v3/contents/generations/tasks'}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', ...(config.wan ? { 'X-DashScope-Async': 'enable' } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000)
        })
        if (!created.ok) throw new Error(`视频模型提交失败（HTTP ${created.status}）`)
        const createdBody = await created.json(),
            id = config.wan ? createdBody.output?.task_id : createdBody.id
        if (!id) throw new Error('视频模型未返回任务编号')
        next.providerTask = { id: String(id), provider }
        return next
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
}
export async function pollLocalReplicaVideo(taskId: string, data: ReplicaData): Promise<ReplicaData> {
    if (!data.providerTask) return data
    const config = await videoConfig(data.providerTask.provider)
    const response = await localFetch(`${config.base}${config.wan ? '/api/v1/tasks/' : '/api/v3/contents/generations/tasks/'}${encodeURIComponent(data.providerTask.id)}`, {
        headers: { Authorization: `Bearer ${config.key}` },
        signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`视频查询失败（HTTP ${response.status}）；供应商任务 ${data.providerTask.id} 已保留`)
    const result = await response.json(),
        status = String(result.output?.task_status || result.status).toLowerCase()
    if (['failed', 'canceled', 'cancelled', 'error'].includes(status)) throw new Error('供应商视频生成失败')
    const url = result.output?.video_url || result.content?.video_url || result.video_url
    if (!url) return data
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-replica-result-'))
    try {
        const download = await localFetch(String(url), { signal: AbortSignal.timeout(120_000) })
        if (!download.ok) throw new Error('视频下载失败')
        const file = path.join(directory, 'video.mp4')
        await fs.writeFile(file, Buffer.from(await download.arrayBuffer()))
        if ((await probeDuration(file)) <= 0) throw new Error('供应商返回无效视频')
        const localUrl = await saveLocalMediaFile(file, `replica/${taskId}`, 'video.mp4')
        return { mode: data.mode, payload: data.payload, output: { ...data.output, videoUrl: localUrl } }
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
}
