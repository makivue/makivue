import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { issueSessionToken } from '@/lib/session-token'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ find: vi.fn() }))
vi.mock('@/services/creator-assets', () => ({ findCreatorAssetReference: mocks.find, deleteCreatorAsset: vi.fn() }))

beforeEach(() => {
    vi.stubEnv('APP_SESSION_SECRET', 'creator-asset-read-test-secret')
    mocks.find.mockReset().mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

function request(authenticated = true) {
    return new NextRequest('https://studio.test/api/create/assets/80', {
        headers: authenticated ? { Authorization: `Bearer ${issueSessionToken({ userId: 7n, email: 'wallet@example.test' })}` } : undefined
    })
}

describe('creator asset deep link', () => {
    it('requires login and validates IDs before loading an asset', async () => {
        expect((await GET(request(false), { params: Promise.resolve({ id: '80' }) })).status).toBe(401)
        expect((await GET(request(), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
        expect(mocks.find).not.toHaveBeenCalled()
    })

    it('returns only the owned asset and returns 404 for missing or inaccessible assets', async () => {
        expect((await GET(request(), { params: Promise.resolve({ id: '80' }) })).status).toBe(404)
        expect(mocks.find).toHaveBeenCalledWith(7n, 80n)
        mocks.find.mockResolvedValue({ asset: { id: '80', type: 'image', url: '/image.png' }, referenceUrl: '/image.png' })
        const response = await GET(request(), { params: Promise.resolve({ id: '80' }) })
        expect(response.status).toBe(200)
        expect((await response.json()).data).toEqual({ id: '80', type: 'image', url: '/image.png' })
    })
})
