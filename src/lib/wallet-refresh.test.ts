import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchWalletRefresh } from './wallet-refresh'
import { WALLET_BALANCE_INVALIDATED_EVENT } from './wallet-gate'

let browser: EventTarget
let page: EventTarget & { visibilityState: string }
let stop: (() => void) | undefined

beforeEach(() => {
    vi.useFakeTimers()
    browser = Object.assign(new EventTarget(), { setInterval, clearInterval })
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', page)
})

afterEach(() => {
    stop?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('wallet page refresh', () => {
    it('refreshes on focus, visibility, billing completion and while remaining open', async () => {
        const load = vi.fn(async () => {})
        stop = watchWalletRefresh(load)
        await Promise.resolve()
        browser.dispatchEvent(new Event('focus'))
        await Promise.resolve()
        page.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
        browser.dispatchEvent(new Event(WALLET_BALANCE_INVALIDATED_EVENT))
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(30_000)
        expect(load).toHaveBeenCalledTimes(5)
        page.visibilityState = 'hidden'
        await vi.advanceTimersByTimeAsync(60_000)
        browser.dispatchEvent(new Event('focus'))
        expect(load).toHaveBeenCalledTimes(5)
    })

    it('coalesces changes during a request and rejects stale responses', async () => {
        let resolve!: () => void
        const currentChecks: Array<() => boolean> = []
        const load = vi.fn(async (isCurrent: () => boolean) => {
            currentChecks.push(isCurrent)
            if (currentChecks.length === 1)
                await new Promise<void>(done => {
                    resolve = done
                })
        })
        stop = watchWalletRefresh(load)
        expect(currentChecks[0]()).toBe(true)
        browser.dispatchEvent(new Event(WALLET_BALANCE_INVALIDATED_EVENT))
        browser.dispatchEvent(new Event(WALLET_BALANCE_INVALIDATED_EVENT))
        expect(currentChecks[0]()).toBe(false)
        expect(load).toHaveBeenCalledTimes(1)
        resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(load).toHaveBeenCalledTimes(2)
        expect(currentChecks[0]()).toBe(false)
        expect(currentChecks[1]()).toBe(true)
        stop()
        expect(currentChecks[1]()).toBe(false)
        browser.dispatchEvent(new Event(WALLET_BALANCE_INVALIDATED_EVENT))
        await vi.advanceTimersByTimeAsync(60_000)
        expect(load).toHaveBeenCalledTimes(2)
    })
})
