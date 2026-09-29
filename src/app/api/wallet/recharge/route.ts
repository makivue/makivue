import { apiError } from '@/lib/utils'

export async function POST() {
    return apiError('本地工作区不使用充值或支付服务', 410)
}
