import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse, handleApiError } from '@/lib/utils'
import { getWalletBalance } from '@/services/billing'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录后查看账户余额', 401)

    try {
        const response = apiResponse({ balancePoints: await getWalletBalance(userId) })
        response.headers.set('Cache-Control', 'private, no-store')
        return response
    } catch (error) {
        console.error('[wallet-balance] failed to load wallet balance', error)
        return handleApiError(error, '账户余额加载失败')
    }
}
