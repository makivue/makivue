import { NextRequest } from 'next/server'
import { apiError } from '@/lib/utils'
import { POST as generateStoryboard, maxDuration } from '@/services/storyboard-generation-handler'

export { maxDuration }

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: Params) {
    const body = await req.json().catch(() => null)
    if (!body || body.type !== 'video') return apiError('视频生成接口仅支持视频任务', 400)

    const headers = new Headers(req.headers)
    headers.delete('content-length')
    headers.set('content-type', 'application/json')
    const delegatedRequest = new NextRequest(req.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    })
    return generateStoryboard(delegatedRequest, context)
}
