export const WALLET_RECHARGE_REQUIRED_STATUS = 402
export const WALLET_RECHARGE_REQUIRED_EVENT = 'wallet:recharge-required'
export const WALLET_BALANCE_INVALIDATED_EVENT = 'wallet:balance-invalidated'

export type WalletRechargeRequiredDetail = {
    message?: string
}

export function requiredWalletPointsFromMessage(message: string | null | undefined): number | null {
    const raw = message?.match(/(?:需要预留|预计需要)\s*([\d,]+(?:\.\d+)?)\s*(?:金币|积分)/)?.[1]
    if (!raw) return null
    const points = Number(raw.replaceAll(',', ''))
    return Number.isFinite(points) && points > 0 ? Math.ceil(points) : null
}

let balanceNotificationQueued = false
let balanceInvalidationVersion = 0

export function getWalletBalanceInvalidationVersion() {
    return balanceInvalidationVersion
}

export function notifyWalletBalanceInvalidated() {
    if (typeof window === 'undefined' || balanceNotificationQueued) return
    balanceNotificationQueued = true
    balanceInvalidationVersion += 1
    queueMicrotask(() => {
        balanceNotificationQueued = false
        window.dispatchEvent(new Event(WALLET_BALANCE_INVALIDATED_EVENT))
    })
}

export function notifyWalletRechargeRequired(message?: string) {
    if (typeof window === 'undefined') return
    const detail: WalletRechargeRequiredDetail = message?.trim() ? { message: message.trim() } : {}
    const event =
        typeof CustomEvent === 'function'
            ? new CustomEvent<WalletRechargeRequiredDetail>(WALLET_RECHARGE_REQUIRED_EVENT, { detail })
            : Object.assign(new Event(WALLET_RECHARGE_REQUIRED_EVENT), { detail })
    window.dispatchEvent(event)
}
