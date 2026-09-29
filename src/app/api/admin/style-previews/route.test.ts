import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'
import { STYLE_PREVIEW_MAX_BYTES, StylePreviewPublishError } from '@/lib/style-preview-publishing'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/admin-permissions', () => ({ requireAdminPermission: mocks.authorize }))
vi.mock('@/services/style-preview-publishing', () => ({ publishStylePreview: mocks.publish }))
const url = 'http://localhost:3000/api/admin/style-previews?key=not-deployed-yet&version=v123&directory=regional-generated'
const request = (overrides = {}) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('source'), ...overrides })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APP_ENV', '')
    mocks.authorize.mockResolvedValue({ response: null })
    mocks.publish.mockResolvedValue({ original: { url: '/style-previews/example.webp' } })
})
afterEach(() => vi.unstubAllEnvs())

describe('local style preview API', () => {
    it.each([401, 403])('honors existing authentication/permission failure %s', async status => {
        mocks.authorize.mockImplementation(async () => ({ response: new Response(null, { status }) }))
        expect((await POST(request())).status).toBe(status)
        expect((await GET(new Request(url))).status).toBe(status)
        expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), 'generate_style_previews')
        expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('works locally without an local storage or production environment', async () => {
        const response = await GET(new Request(url))
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ data: { environment: 'local', prefix: 'style-previews' } })
        expect((await POST(request())).status).toBe(200)
    })

    it('accepts new local keys without contacting a remote catalog', async () => {
        expect((await POST(request())).status).toBe(200)
        expect(mocks.publish).toHaveBeenCalledWith({ key: 'not-deployed-yet', version: 'v123', directory: 'regional-generated' }, Buffer.from('source'), 'image/webp')
    })

    it.each(['key=../other&version=v1', 'key=good&version=../v1', 'key=good&version=v1&directory=../other'])('rejects unsafe path: %s', async query => {
        const req = new Request(`http://localhost:3000/api/admin/style-previews?${query}`, { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: 'source' })
        expect((await POST(req)).status).toBe(400)
        expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('rejects empty bodies and unsupported types', async () => {
        expect((await POST(request({ body: '' }))).status).toBe(400)
        expect((await POST(request({ headers: { 'Content-Type': 'image/svg+xml' } }))).status).toBe(415)
        expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('enforces actual body size even without a Content-Length header', async () => {
        const req = request({ body: new Uint8Array(STYLE_PREVIEW_MAX_BYTES + 1) })
        expect((await POST(req)).status).toBe(413)
        expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('preserves validation errors and hides raw filesystem errors', async () => {
        mocks.publish.mockRejectedValueOnce(new StylePreviewPublishError('Use a new version', 409))
        expect((await POST(request())).status).toBe(409)
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            mocks.publish.mockRejectedValueOnce(new Error('secret-storage-detail'))
            const response = await POST(request())
            expect(response.status).toBe(502)
            expect(await response.text()).not.toContain('secret-storage-detail')
            expect(JSON.stringify(log.mock.calls)).not.toContain('secret-storage-detail')
        } finally {
            log.mockRestore()
        }
    })
})
