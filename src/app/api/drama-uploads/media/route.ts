import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { DRAMA_PART_BYTES, DRAMA_MAX_PART_BYTES, DRAMA_MAX_UPLOAD_PARTS, DRAMA_UPLOAD_PROTOCOL, type DramaAssetKind } from '@/lib/drama-upload'
import { apiError, apiResponse } from '@/lib/utils'
import { createDramaUploadStore, DramaUploadError } from '@/services/drama-upload'

export const runtime = 'nodejs'
export const maxDuration = 60

function failure(error: unknown) {
    return apiError(error instanceof DramaUploadError ? error.message : '上传失败，请稍后重试', error instanceof DramaUploadError ? error.status : 503)
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('上传内容无效')
    try {
        const store = await createDramaUploadStore(userId)
        if (body.action === 'begin') {
            if (!['cover', 'video', 'subtitle', 'portrait'].includes(body.kind) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255 || typeof body.size !== 'number')
                return apiError('上传内容无效')
            if (body.protocol !== undefined && body.protocol !== DRAMA_UPLOAD_PROTOCOL) return apiError('上传内容无效')
            return apiResponse(await store.begin(body.kind as DramaAssetKind, body.name, body.size, body.protocol), 201)
        }
        if (body.action !== 'complete' || typeof body.token !== 'string' || !Array.isArray(body.parts) || body.parts.length > DRAMA_MAX_UPLOAD_PARTS) return apiError('上传内容无效')
        return apiResponse(await store.complete(store.readTicket(body.token), body.parts), 201)
    } catch (error) {
        return failure(error)
    }
}

export async function PUT(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    try {
        if (!req.body || Number(req.headers.get('content-length')) > DRAMA_MAX_PART_BYTES) return apiError('上传内容无效', 413)
        const store = await createDramaUploadStore(userId)
        const ticket = store.readTicket(req.headers.get('x-upload-token') ?? '')
        const limit = ticket.protocol === DRAMA_UPLOAD_PROTOCOL ? DRAMA_MAX_PART_BYTES : DRAMA_PART_BYTES
        if (Number(req.headers.get('content-length')) > limit) return apiError('上传内容无效', 413)
        const reader = req.body.getReader()
        const chunks: Buffer[] = []
        let length = 0
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                length += value.length
                if (length > limit) {
                    await reader.cancel()
                    return apiError('上传内容无效', 413)
                }
                chunks.push(Buffer.from(value))
            }
        } finally {
            reader.releaseLock()
        }
        return apiResponse(await store.part(ticket, Number(req.nextUrl.searchParams.get('part')), Buffer.concat(chunks)))
    } catch (error) {
        return failure(error)
    }
}

export async function DELETE(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    try {
        const store = await createDramaUploadStore(userId)
        await store.abort(store.readTicket(req.headers.get('x-upload-token') ?? ''))
        return apiResponse({ removed: true })
    } catch (error) {
        return failure(error)
    }
}
