import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { parseImportTextFast } from '@/services/script-import'
import { IMPORT_MAX_TEXT_LENGTH } from '@/lib/project-metadata'
import { buildProjectImportPreview } from '@/lib/project-import-preview'
import { genId } from '@/lib/id'

export const maxDuration = 300

export async function POST(req: NextRequest) {
    try {
        const userId = currentUserId(req)
        if (userId === null) return apiError('login required', 401)

        const body = await req.json().catch(() => null)
        if (!body || typeof body.text !== 'string') return apiError('text is required')
        const rawText = body.text.trim()
        if (rawText.length < 20) return apiError('导入内容过短，请提供更完整的剧本')
        if (rawText.length > IMPORT_MAX_TEXT_LENGTH) return apiError('导入内容过长，请拆分后再导入（限 20 万字以内）')

        const filename = typeof body.filename === 'string' ? body.filename : undefined
        const detected = parseImportTextFast(rawText, filename)
        const result = buildProjectImportPreview(detected, rawText)

        // Recognition is intentionally stateless: document parsing must remain
        // available even if the database or background worker is temporarily down.
        return apiResponse({ importId: genId().toString(), result, mode: 'fast' })
    } catch (error) {
        console.error('[project-import] fast parse failed', error)
        return apiError('剧本解析失败，请检查内容格式后重试', 500)
    }
}
