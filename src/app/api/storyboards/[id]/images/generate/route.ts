import { NextRequest } from 'next/server'
import { apiError } from '@/lib/utils'
import { POST as generateStoryboard, maxDuration } from '@/services/storyboard-generation-handler'

export { maxDuration }

type Params = { params: Promise<{ id: string }> }

const IMAGE_GENERATION_TYPES = new Set(['illustrations', 'first_frame', 'last_frame'])

export async function POST(req: NextRequest, context: Params) {
    const body = await req.json().catch(() => null)
    if (!body || !IMAGE_GENERATION_TYPES.has(body.type)) return apiError('图片生成接口仅支持插图任务', 400)

    // Image generation has no dependency on the video model. Drop legacy or
    // manually supplied video fields so an image request cannot be mistaken
    // for a Seedance/Happy Horse video request downstream.
    const imageBody = { ...body }
    delete imageBody.provider
    delete imageBody.videoProvider
    delete imageBody.referenceMode

    const headers = new Headers(req.headers)
    headers.delete('content-length')
    headers.set('content-type', 'application/json')
    const delegatedRequest = new NextRequest(req.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(imageBody)
    })
    return generateStoryboard(delegatedRequest, context)
}
