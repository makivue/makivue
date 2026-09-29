export type WalletPaymentResult = {
    key: string
    status: 'paid' | 'failed' | 'timeout' | 'error'
    error?: string
}

export function walletPaymentNotice(paymentStatus: string | null, orderId: string | null, result: WalletPaymentResult | null) {
    if (result?.status === 'paid') return { kind: 'success', text: '充值成功，积分已到账' }
    if (result?.status === 'failed') return { kind: 'error', text: '支付未完成，请重新充值或稍后查询。' }
    if (result?.status === 'error') return { kind: 'error', text: result.error || '充值处理失败' }
    if (result?.status === 'timeout') return { kind: 'pending', text: '支付结果仍在确认中，请稍后刷新页面。' }
    if (paymentStatus === 'cancelled') return { kind: 'pending', text: '支付已取消，积分余额没有变化。' }
    if (orderId && (paymentStatus === 'success' || paymentStatus === 'result')) return { kind: 'pending', text: '正在确认支付结果，请稍候。' }
    return null
}
