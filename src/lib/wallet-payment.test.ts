import { describe, expect, it } from 'vitest'
import { walletPaymentNotice } from './wallet-payment'

describe('payment return notices', () => {
    it('replaces pending with a single terminal failure or success', () => {
        expect(walletPaymentNotice('result', '123', null)).toEqual({ kind: 'pending', text: '正在确认支付结果，请稍候。' })
        expect(walletPaymentNotice('result', '123', { key: '123', status: 'failed' })).toEqual({ kind: 'error', text: '支付未完成，请重新充值或稍后查询。' })
        expect(walletPaymentNotice('result', '123', { key: '123', status: 'paid' })).toEqual({ kind: 'success', text: '充值成功，积分已到账' })
    })

    it('does not announce payment success from an unverified return URL', () => {
        expect(walletPaymentNotice('success', '123', null)?.kind).toBe('pending')
        expect(walletPaymentNotice('success', null, null)).toBeNull()
        expect(walletPaymentNotice(null, null, null)).toBeNull()
    })

    it('shows cancellation, timeout and final query errors without pending success banners', () => {
        expect(walletPaymentNotice('cancelled', '123', null)?.text).toBe('支付已取消，积分余额没有变化。')
        expect(walletPaymentNotice('result', '123', { key: '123', status: 'timeout' })?.text).toBe('支付结果仍在确认中，请稍后刷新页面。')
        expect(walletPaymentNotice('result', '123', { key: '123', status: 'error', error: 'Network error' })).toEqual({ kind: 'error', text: 'Network error' })
    })
})
