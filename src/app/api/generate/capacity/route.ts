import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import {
    getGenerationConcurrencyLimitMessage,
    getUserGenerationCapacity,
    type GenerationCategory
} from '@/lib/generation-concurrency'
import { apiError, apiResponse } from '@/lib/utils'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)

    const value = new URL(req.url).searchParams.get('category')
    if (value !== 'image' && value !== 'video') return apiError('Invalid generation type', 400)

    const category: GenerationCategory = value
    const capacity = await getUserGenerationCapacity(userId, category)
    return apiResponse({
        ...capacity,
        message: capacity.available ? null : getGenerationConcurrencyLimitMessage(category)
    })
}
