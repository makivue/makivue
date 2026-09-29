import { describe, expect, it, vi } from 'vitest'
import { createConcurrencyLimiter, runWithConcurrency } from './bounded-concurrency'

describe('bounded concurrency', () => {
    it('runs no more than the requested number of workers', async () => {
        let active = 0
        let maxActive = 0
        const completed: number[] = []

        await runWithConcurrency([0, 1, 2, 3, 4, 5, 6], 5, async item => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise(resolve => setTimeout(resolve, 2))
            completed.push(item)
            active -= 1
        })

        expect(maxActive).toBe(5)
        expect(completed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
    })

    it('releases a limiter slot after an operation fails', async () => {
        const withLimit = createConcurrencyLimiter(1)
        await expect(withLimit(async () => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
        await expect(withLimit(async () => 'recovered')).resolves.toBe('recovered')
    })

    it('hands released slots to queued work in FIFO order', async () => {
        const withLimit = createConcurrencyLimiter(1)
        const started: number[] = []
        const releases: Array<() => void> = []
        const jobs = [1, 2, 3].map(value =>
            withLimit(async () => {
                started.push(value)
                await new Promise<void>(resolve => releases.push(resolve))
            })
        )

        await vi.waitFor(() => expect(started).toEqual([1]))
        releases.shift()?.()
        await vi.waitFor(() => expect(started).toEqual([1, 2]))
        releases.shift()?.()
        await vi.waitFor(() => expect(started).toEqual([1, 2, 3]))
        releases.shift()?.()
        await Promise.all(jobs)
    })
})
