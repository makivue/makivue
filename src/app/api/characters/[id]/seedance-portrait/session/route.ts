import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertCharacterOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { genId } from '@/lib/id'
import { getSeedanceConfig } from '@/services/seedance-config'
import { createSeedanceVisualValidationSession } from '@/services/seedance-assets'

type Params = { params: Promise<{ id: string }> }

function publicBaseUrl(req: NextRequest): string {
    const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, '')
    if (configured) return configured
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`
    return req.nextUrl.origin
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const characterId = parseApiId(id)
    if (characterId === null) return apiError('角色 ID 格式无效', 400)
    const guard = await assertCharacterOwner(characterId, userId)
    if (guard) return guard

    const character = await prisma.character.findFirst({
        where: { id: characterId, deletedAt: null },
        select: { id: true }
    })
    if (!character) return apiError('角色不存在', 404)
    const config = await getSeedanceConfig()
    if (!config?.apiKey) return apiError('视频生成人像认证配置不可用，请联系管理员', 503)

    const state = randomBytes(32).toString('base64url')
    const callbackUrl = `${publicBaseUrl(req)}/api/seedance/portrait/callback/${state}`
    if (!/^https:\/\//i.test(callbackUrl) || /https:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/)/i.test(callbackUrl)) {
        return apiError('真人认证需要公网 HTTPS 回调地址，请配置 NEXT_PUBLIC_BASE_URL', 503)
    }

    try {
        const session = await createSeedanceVisualValidationSession(config, callbackUrl, { signal: req.signal })
        const expiresAt = new Date(Date.now() + 29 * 60_000)
        await prisma.$transaction(async tx => {
            await tx.seedancePortraitSession.updateMany({
                where: { characterId, status: 'pending' },
                data: { status: 'expired', bytedToken: null, errorMsg: '已创建新的真人认证链接' }
            })
            await tx.seedancePortraitSession.create({
                data: {
                    id: genId(),
                    characterId,
                    state,
                    bytedToken: session.bytedToken,
                    projectName: session.projectName,
                    status: 'pending',
                    expiresAt
                }
            })
            await tx.character.update({
                where: { id: characterId },
                data: { seedancePortraitStatus: 'pending' }
            })
        })
        return apiResponse({ h5Link: session.h5Link, expiresAt })
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '创建真人认证失败', 502)
    }
}
