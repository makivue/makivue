import { localFetch } from '@/lib/local-fetch'
import { createHmac } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import { saveLocalMediaFile } from '@/services/local-media'
import { probeDuration, withFfmpegSlot } from '@/services/ffmpeg'
import { chargeModelUsage } from '@/services/billing'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { fetchMeteredProvider } from '@/lib/provider-token-usage.server'
import { releaseModelReservations } from './wallet-reservations'

type KlingStoryboard = {
    id: bigint
    shotType: string | null
    duration: number | null
    dialogue: string | null
    actionDesc: string | null
    imagePrompt: string | null
    videoPrompt: string | null
    negativePrompt: string | null
    firstFrameUrl: string | null
    characters: Array<{ character: { name: string; appearancePrompt: string | null } }>
    scene: { name?: string | null; locationPrompt: string | null } | null
}

function base64Url(value: string | Buffer) {
    return Buffer.from(value).toString('base64url')
}

export function parseKlingCredentials(value: string | null | undefined) {
    const [accessKey, ...secretParts] = (value ?? '').split(':')
    const secretKey = secretParts.join(':')
    if (!accessKey?.trim() || !secretKey?.trim()) {
        throw new Error('Kling 对照测试尚未配置：请设置 KLING_ACCESS_KEY 和 KLING_SECRET_KEY，或 KLING_API_KEY（Access Key:Secret Key）。')
    }
    return { accessKey: accessKey.trim(), secretKey: secretKey.trim() }
}

export function getKlingConfig() {
    const credentials = parseKlingCredentials(process.env.KLING_API_KEY || `${process.env.KLING_ACCESS_KEY ?? ''}:${process.env.KLING_SECRET_KEY ?? ''}`)
    return {
        ...credentials,
        baseUrl: (process.env.KLING_BASE_URL?.trim() || 'https://api.klingai.com').replace(/\/$/, ''),
        modelName: process.env.KLING_MODEL?.trim() || 'kling-v2-1-master'
    }
}

export function createKlingJwt(accessKey: string, secretKey: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64Url(JSON.stringify({ iss: accessKey, exp: nowSeconds + 1800, nbf: nowSeconds - 5 }))
    const unsigned = `${header}.${payload}`
    const signature = createHmac('sha256', secretKey).update(unsigned).digest('base64url')
    return `${unsigned}.${signature}`
}

function normalizeKlingDuration(duration: number | null) {
    return (duration ?? 5) > 5 ? '10' : '5'
}

function buildKlingPrompt(storyboard: KlingStoryboard) {
    const characters = storyboard.characters
        .map(item => [item.character.name, item.character.appearancePrompt].filter(Boolean).join(': '))
        .filter(Boolean)
        .join('; ')
    return [
        storyboard.videoPrompt || storyboard.actionDesc || storyboard.imagePrompt,
        characters ? `Identity and wardrobe lock: ${characters}` : null,
        storyboard.scene?.locationPrompt ? `Scene lock: ${storyboard.scene.locationPrompt}` : null,
        `Opening composition: ${storyboard.shotType ?? 'medium'}. Follow the content-adaptive semantic-beat camera and transition instructions from the video plan; do not impose one fixed movement on the full clip.`,
        'High-dynamic comparison sample: one continuous readable action, strong but physically plausible motion, stable face and body geometry, exact wardrobe and scene continuity from the input image.',
        'No cuts, no scene transition, no extra people, no face morphing, no body warping, no text, no subtitles, no logos, no watermark.'
    ]
        .filter(Boolean)
        .join(' ')
}

async function pollKlingTask(baseUrl: string, token: string, taskId: string, model: string, signal?: AbortSignal) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (signal?.aborted) throw new Error('已取消 Kling 对照任务')
        await new Promise(resolve => setTimeout(resolve, 10_000))
        const response = await fetchMeteredProvider(
            `${baseUrl}/v1/videos/image2video/${encodeURIComponent(taskId)}`,
            {
                headers: { Authorization: `Bearer ${token}` },
                signal: fetchTimeoutSignal(30_000, signal)
            },
            { provider: 'kling', model }
        )
        if (!response.ok) throw new Error(`Kling 查询失败（${response.status}）：${(await response.text()).slice(0, 300)}`)
        const data = await response.json()
        const status = String(data?.data?.task_status ?? data?.task_status ?? '').toLowerCase()
        if (status === 'succeed' || status === 'success' || status === 'completed') {
            const url = data?.data?.task_result?.videos?.[0]?.url ?? data?.data?.videos?.[0]?.url
            if (!url) throw new Error('Kling 对照任务已完成，但没有返回视频地址')
            return String(url)
        }
        if (status === 'failed' || status === 'error') {
            throw new Error(`Kling 对照生成失败：${data?.data?.task_status_msg ?? data?.message ?? 'unknown error'}`)
        }
    }
    throw new Error('Kling 对照生成等待超时')
}

export async function generateKlingComparison(generationId: bigint, storyboard: KlingStoryboard, userId: bigint, signal?: AbortSignal) {
    return withHiModelsUsageScope({ userId, generationId: String(generationId) }, () => generateKlingComparisonWithBilling(generationId, storyboard, userId, signal))
}

async function generateKlingComparisonWithBilling(generationId: bigint, storyboard: KlingStoryboard, userId: bigint, signal?: AbortSignal) {
    try {
        if (!storyboard.firstFrameUrl) throw new Error('Kling 高动态对照需要先生成主插图')
        const { accessKey, secretKey, baseUrl, modelName: model } = getKlingConfig()
        const token = createKlingJwt(accessKey, secretKey)
        const prompt = buildKlingPrompt(storyboard)
        const requestBody = {
            model_name: model,
            image: storyboard.firstFrameUrl,
            prompt,
            negative_prompt: storyboard.negativePrompt ?? 'face morphing, body warping, extra limbs, extra people, text, subtitle, logo, watermark',
            cfg_scale: 0.5,
            mode: 'pro',
            duration: normalizeKlingDuration(storyboard.duration)
        }
        await prisma.generation.update({
            where: { id: generationId },
            data: { prompt, modelName: model, requestBody: JSON.stringify({ comparisonOnly: true, ...requestBody }) }
        })
        const createResponse = await fetchMeteredProvider(
            `${baseUrl}/v1/videos/image2video`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(requestBody),
                signal: fetchTimeoutSignal(60_000, signal)
            },
            { provider: 'kling', model }
        )
        if (!createResponse.ok) throw new Error(`Kling 创建对照任务失败（${createResponse.status}）：${(await createResponse.text()).slice(0, 300)}`)
        const createData = await createResponse.json()
        const taskId = createData?.data?.task_id ?? createData?.task_id
        if (!taskId) throw new Error(`Kling 没有返回任务 ID：${JSON.stringify(createData).slice(0, 300)}`)
        await prisma.generation.update({ where: { id: generationId }, data: { taskId: String(taskId) } })
        const videoUrl = await pollKlingTask(baseUrl, token, String(taskId), model, signal)

        const filename = `kling_compare_${generationId}.mp4`
        const absPath = path.join(process.cwd(), 'public', 'storage', filename)
        const downloadResponse = await localFetch(videoUrl, { signal: fetchTimeoutSignal(120_000, signal) })
        if (!downloadResponse.ok) throw new Error(`Kling 对照视频下载失败（${downloadResponse.status}）`)
        await fs.mkdir(path.dirname(absPath), { recursive: true })
        await fs.writeFile(absPath, Buffer.from(await downloadResponse.arrayBuffer()))
        const duration = await withFfmpegSlot(() => probeDuration(absPath))
        if (!Number.isFinite(duration) || duration <= 0.05) throw new Error('Kling 对照视频文件无效或时长为 0')
        const resultUrl = await saveLocalMediaFile(absPath, `storyboards/${storyboard.id}/comparisons`, filename)
        await prisma.$transaction(async tx => {
            await chargeModelUsage({
                userId,
                tx,
                idempotencyKey: `usage:generation:${generationId}`,
                sourceType: 'generation',
                sourceId: generationId.toString(),
                description: '视频对照样片 · kling',
                metadata: { storyboardId: storyboard.id.toString(), provider: 'kling', generationType: 'video_comparison' }
            })
            await tx.generation.update({
                where: { id: generationId },
                data: {
                    status: 'completed',
                    resultUrl,
                    completedAt: new Date(),
                    metrics: { comparisonOnly: true, durationSeconds: duration }
                }
            })
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await prisma.generation.updateMany({
            where: { id: generationId, status: { in: ['queued', 'processing'] } },
            data: { status: signal?.aborted ? 'cancelled' : 'failed', errorMsg: message, completedAt: new Date() }
        })
        await releaseModelReservations(`generation:${generationId}`, userId)
    }
}
