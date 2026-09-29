import { describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { GET } from './status/route'

describe('local payment endpoints', () => {
    it.each([POST, GET])('refuses payment operations without contacting a service', async handler => {
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)
        try {
            const response = await handler()
            expect(response.status).toBe(410)
            expect(fetch).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
