import { timingSafeEqual } from 'node:crypto'
import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSeedanceConfig } from '@/services/seedance-config'
import { getSeedanceVisualValidationResult } from '@/services/seedance-assets'
import { syncCharacterSeedancePortraitAssets } from '@/services/seedance-portrait'

type Params = { params: Promise<{ state: string }> }
export const maxDuration = 300

function html(message: string, success: boolean, status = 200) {
    const color = success ? '#22c55e' : '#ef4444'
    const title = success ? '真人认证完成' : '真人认证未完成'
    return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#09090b;color:#fff;font-family:system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><div style="font-size:44px;color:${color}">${success ? '✓' : '!'}</div><h1 style="font-size:22px">${title}</h1><p style="color:#a1a1aa;line-height:1.7">${message}</p><p style="color:#71717a;font-size:13px">现在可以关闭此页面。</p></main></body></html>`, {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    })
}

function sameToken(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export async function GET(req: NextRequest, { params }: Params) {
    const { state } = await params
    if (!/^[A-Za-z0-9_-]{32,80}$/.test(state)) return html('认证链接无效，请返回项目重新发起。', false, 400)

    const session = await prisma.seedancePortraitSession.findUnique({
        where: { state },
        include: { character: { select: { id: true, deletedAt: true } } }
    })
    if (!session || session.character.deletedAt) return html('认证会话不存在或角色已被删除。', false, 404)
    if (session.status === 'completed') return html('认证和授权已经完成，角色素材正在自动入库。', true)
    if (session.status !== 'pending' || session.expiresAt.getTime() < Date.now() || !session.bytedToken) {
        return html('认证链接已过期，请返回项目重新发起。', false, 410)
    }

    const resultCode = req.nextUrl.searchParams.get('resultCode') ?? ''
    const callbackToken = req.nextUrl.searchParams.get('bytedToken') ?? ''
    if (!callbackToken || !sameToken(session.bytedToken, callbackToken)) {
        return html('认证回调校验失败，请返回项目重新发起。', false, 403)
    }
    if (resultCode !== '10000') {
        await prisma.$transaction([
            prisma.seedancePortraitSession.update({
                where: { id: session.id },
                data: { status: 'failed', resultCode, bytedToken: null, completedAt: new Date(), errorMsg: `真人认证未通过（${resultCode || '未知错误'}）` }
            }),
            prisma.character.update({
                where: { id: session.characterId },
                data: { seedancePortraitStatus: 'failed' }
            })
        ])
        return html('真人认证未通过，请检查光线、正脸角度后重新认证。', false, 422)
    }

    const config = await getSeedanceConfig()
    if (!config?.apiKey) return html('系统的人像认证配置暂时不可用，请联系管理员。', false, 503)
    try {
        const result = await getSeedanceVisualValidationResult(config, session.bytedToken, { signal: req.signal })
        await prisma.$transaction([
            prisma.seedancePortraitSession.update({
                where: { id: session.id },
                data: { status: 'completed', resultCode, bytedToken: null, completedAt: new Date(), errorMsg: null }
            }),
            prisma.character.update({
                where: { id: session.characterId },
                data: {
                    seedanceAssetGroupId: result.groupId,
                    seedancePortraitStatus: 'authorized'
                }
            })
        ])
        after(async () => {
            try {
                await syncCharacterSeedancePortraitAssets(session.characterId, config)
            } catch (error) {
                console.error('[seedance-portrait] automatic asset sync failed:', error)
            }
        })
        return html('认证与授权已完成。请返回项目角色页，等待真人素材显示为可用后再生成视频。', true)
    } catch (error) {
        await prisma.seedancePortraitSession.update({
            where: { id: session.id },
            data: { errorMsg: error instanceof Error ? error.message : String(error) }
        })
        return html('认证已通过，但获取真人素材组失败，请返回项目重试。', false, 502)
    }
}
