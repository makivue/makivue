export async function runWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
    if (items.length === 0) return
    const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length))
    let nextIndex = 0

    await Promise.all(
        Array.from({ length: limit }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++
                await worker(items[index], index)
            }
        })
    )
}

export function createConcurrencyLimiter(concurrency: number) {
    const limit = Math.max(1, Math.floor(concurrency) || 1)
    let active = 0
    const waiting: Array<() => void> = []

    const acquire = async () => {
        if (active < limit) {
            active += 1
            return
        }
        await new Promise<void>(resolve => waiting.push(resolve))
    }

    const release = () => {
        const next = waiting.shift()
        if (next) next()
        else active -= 1
    }

    return async function withConcurrencyLimit<T>(operation: () => Promise<T>): Promise<T> {
        await acquire()
        try {
            return await operation()
        } finally {
            release()
        }
    }
}
