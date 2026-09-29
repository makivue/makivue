import { NextRequest } from 'next/server'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { extractScriptDocumentText } from '@/services/document-text'
import { IMPORT_MAX_DOCUMENT_BYTES, IMPORT_MAX_TEXT_LENGTH } from '@/lib/project-metadata'

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > IMPORT_MAX_DOCUMENT_BYTES + 1024 * 1024) {
        return apiError('上传请求过大，请上传 8MB 以内的文件', 413)
    }

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return apiError('请选择要上传的剧本文档')
    if (file.size === 0) return apiError('上传的文档为空')
    if (file.size > IMPORT_MAX_DOCUMENT_BYTES) return apiError('文档过大，请上传 8MB 以内的文件', 413)

    try {
        const text = await extractScriptDocumentText(file.name, Buffer.from(await file.arrayBuffer()))
        if (text.length < 20) return apiError('文档内容过短，请提供至少 20 字的剧本内容')
        if (text.length > IMPORT_MAX_TEXT_LENGTH) return apiError('文档内容超过 20 万字，请拆分后再导入')
        return apiResponse({ filename: file.name, text, characterCount: text.length })
    } catch (err) {
        return apiError(err instanceof Error ? err.message : String(err), 422)
    }
}
