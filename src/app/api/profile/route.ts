import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { prisma } from '@/lib/prisma'
import { normalizeProfileAvatarUrl, normalizeProfileDisplayName, PROFILE_AVATAR_EXTENSIONS, PROFILE_AVATAR_MAX_BYTES, PROFILE_DISPLAY_NAME_MAX_LENGTH } from '@/lib/profile'
import { apiError, apiResponse } from '@/lib/utils'
import { deleteLocalMediaWithinSubdirectory, saveLocalMediaFile } from '@/services/local-media'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)

    const [profile, identity] = await Promise.all([
        prisma.userProfile.findUnique({
            where: { userId },
            select: { displayName: true, avatarUrl: true }
        }),
        prisma.userIdentity.findUnique({
            where: { userId_provider: { userId, provider: 'google' } },
            select: { displayName: true, avatarUrl: true }
        })
    ])
    return apiResponse({
        displayName: profile?.displayName ?? identity?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? identity?.avatarUrl ?? null
    })
}

export async function PUT(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)

    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > PROFILE_AVATAR_MAX_BYTES + 512 * 1024) {
        return apiError('头像图片不能超过 5MB', 413)
    }

    const form = await req.formData().catch(() => null)
    if (!form) return apiError('资料内容无效')

    const rawDisplayName = form.get('displayName')
    const displayName = normalizeProfileDisplayName(rawDisplayName)
    if (!displayName) {
        if (typeof rawDisplayName === 'string' && rawDisplayName.trim()) {
            return apiError(`昵称不能超过 ${PROFILE_DISPLAY_NAME_MAX_LENGTH} 个字符`)
        }
        return apiError('请输入昵称')
    }

    const avatar = form.get('avatar')
    const avatarFile = avatar instanceof File && avatar.size > 0 ? avatar : null
    if (avatarFile && avatarFile.size > PROFILE_AVATAR_MAX_BYTES) return apiError('头像图片不能超过 5MB', 413)
    const extension = avatarFile ? PROFILE_AVATAR_EXTENSIONS[avatarFile.type] : null
    if (avatarFile && !extension) return apiError('头像仅支持 JPG、PNG、WebP 格式')

    const current = await prisma.userProfile.findUnique({
        where: { userId },
        select: { avatarUrl: true }
    })
    const retainedAvatarUrl = current?.avatarUrl ?? normalizeProfileAvatarUrl(form.get('avatarUrl'))
    if (!avatarFile && !retainedAvatarUrl) return apiError('请上传头像')

    const avatarSubdir = `profiles/${userId}/avatars`
    let tempDir: string | null = null
    let uploadedAvatarUrl: string | null = null
    let profileSaved = false
    try {
        if (avatarFile && extension) {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-profile-avatar-'))
            const filename = `avatar_${Date.now()}_${randomUUID()}${extension}`
            const tempPath = path.join(tempDir, filename)
            await fs.writeFile(tempPath, Buffer.from(await avatarFile.arrayBuffer()))
            uploadedAvatarUrl = await saveLocalMediaFile(tempPath, avatarSubdir, filename)
        }

        const avatarUrl = uploadedAvatarUrl ?? retainedAvatarUrl
        if (!avatarUrl) return apiError('请上传头像')
        const profile = await prisma.userProfile.upsert({
            where: { userId },
            update: { displayName, avatarUrl },
            create: { userId, displayName, avatarUrl },
            select: { displayName: true, avatarUrl: true }
        })
        profileSaved = true

        if (uploadedAvatarUrl && current?.avatarUrl && current.avatarUrl !== uploadedAvatarUrl) {
            await deleteLocalMediaWithinSubdirectory(current.avatarUrl, avatarSubdir).catch(() => {})
        }
        return apiResponse(profile)
    } catch (error) {
        if (uploadedAvatarUrl && !profileSaved) {
            await deleteLocalMediaWithinSubdirectory(uploadedAvatarUrl, avatarSubdir).catch(() => {})
        }
        console.error('Profile update failed:', error)
        return apiError(avatarFile ? '头像上传失败，请稍后重试' : '资料保存失败，请稍后重试', 500)
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}
