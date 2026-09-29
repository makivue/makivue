import { NextRequest } from 'next/server'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertCharacterOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { refreshCharacterSeedancePortraitAssets, submitCharacterSeedancePortraitAsset, syncCharacterSeedancePortraitAssets } from '@/services/seedance-portrait'
import { saveLocalMediaFile } from '@/services/local-media'

type Params = { params: Promise<{ id: string }> }
export const maxDuration = 300
const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const IMAGE_EXTENSIONS: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp'
}

function detectedImageExtension(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp'
    return null
}

async function ownedCharacter(req: NextRequest, params: Params['params']) {
    const userId = currentUserId(req)
    if (userId === null) return { response: apiError('login required', 401) }
    const { id } = await params
    const characterId = parseApiId(id)
    if (characterId === null) return { response: apiError('角色 ID 格式无效', 400) }
    const guard = await assertCharacterOwner(characterId, userId)
    if (guard) return { response: guard }
    return { characterId }
}

async function portraitSummary(characterId: bigint) {
    const character = await prisma.character.findFirst({
        where: { id: characterId, deletedAt: null },
        select: {
            seedancePortraitStatus: true,
            seedanceAssetGroupId: true,
            seedancePortraitAssets: {
                select: { id: true, role: true, sourceUrl: true, status: true, errorMsg: true, createdAt: true },
                orderBy: { createdAt: 'desc' }
            }
        }
    })
    if (!character) return null
    return {
        status: character.seedancePortraitStatus,
        authorized: !!character.seedanceAssetGroupId,
        assets: character.seedancePortraitAssets
    }
}

export async function GET(req: NextRequest, { params }: Params) {
    const owned = await ownedCharacter(req, params)
    if ('response' in owned) return owned.response
    try {
        await refreshCharacterSeedancePortraitAssets(owned.characterId)
        const summary = await portraitSummary(owned.characterId)
        return summary ? apiResponse(summary) : apiError('角色不存在', 404)
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '刷新真人素材状态失败', 502)
    }
}

export async function POST(req: NextRequest, { params }: Params) {
    const owned = await ownedCharacter(req, params)
    if ('response' in owned) return owned.response
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
        const declaredLength = Number(req.headers.get('content-length') ?? 0)
        if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES + 1024 * 1024) return apiError('真人素材最大 30MB', 413)
        const character = await prisma.character.findFirst({
            where: { id: owned.characterId, deletedAt: null },
            select: { projectId: true, seedanceAssetGroupId: true, seedancePortraitStatus: true }
        })
        if (!character) return apiError('角色不存在', 404)
        if (!character.seedanceAssetGroupId || character.seedancePortraitStatus !== 'authorized') return apiError('请先完成真人认证，再上传素材', 409)

        const form = await req.formData().catch(() => null)
        const file = form?.get('file')
        const role = form?.get('role')
        if (!(file instanceof File)) return apiError('请选择真人素材图片')
        if (role !== 'face' && role !== 'full_body') return apiError('请选择人脸特写或正面全身素材')
        if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return apiError('真人素材图片大小应为 1B-30MB')
        const extension = IMAGE_EXTENSIONS[file.type]
        if (!extension) return apiError('真人素材仅支持 PNG、JPEG、WebP')
        const buffer = Buffer.from(await file.arrayBuffer())
        if (detectedImageExtension(buffer) !== extension) return apiError('图片实际内容与文件类型不一致', 422)

        const filename = `portrait_${owned.characterId}_${role}_${Date.now()}_${randomUUID().slice(0, 8)}${extension}`
        const tempDir = path.join(process.cwd(), 'public', 'storage')
        const tempPath = path.join(tempDir, filename)
        await fs.mkdir(tempDir, { recursive: true })
        await fs.writeFile(tempPath, buffer)
        let sourceUrl: string
        try {
            sourceUrl = await saveLocalMediaFile(tempPath, `seedance-portraits/${character.projectId}/${owned.characterId}`, filename)
        } catch (error) {
            return apiError(`真人素材上传失败：${error instanceof Error ? error.message : String(error)}`, 502)
        } finally {
            await fs.unlink(tempPath).catch(() => undefined)
        }

        const submitted = await submitCharacterSeedancePortraitAsset(owned.characterId, {
            sourceUrl,
            role,
            name: file.name || filename
        })
        if (submitted.status === 'failed') return apiError(`素材已保存，但提交一致性校验失败：${submitted.error ?? '请稍后重试'}`, 502)
        return apiResponse({ status: submitted.status, sourceUrl })
    }

    const body = (await req.json().catch(() => null)) as { action?: string } | null
    if (body?.action !== 'sync') return apiError('不支持的真人素材操作')
    try {
        const sync = await syncCharacterSeedancePortraitAssets(owned.characterId)
        await refreshCharacterSeedancePortraitAssets(owned.characterId)
        const summary = await portraitSummary(owned.characterId)
        return apiResponse({ sync, ...summary })
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '同步真人素材失败', 502)
    }
}
