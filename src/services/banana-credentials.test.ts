import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { assertNanoBananaCredentialsConfigured, getGoogleAuthClient, NanoBananaConfigurationError, resetGoogleAuthCache, resolveBananaLocalImagePath } from './banana'
import { GoogleAuth } from 'google-auth-library'

vi.mock('google-auth-library', () => ({
    GoogleAuth: vi.fn(
        class {
            getClient = vi.fn().mockResolvedValue({})
        }
    )
}))

beforeEach(() => {
    resetGoogleAuthCache()
    vi.mocked(GoogleAuth).mockClear()
    for (const name of ['NANO_BANANA_SERVICE_ACCOUNT_JSON', 'NANO_BANANA_SERVICE_ACCOUNT_JSON_B64', 'NANO_BANANA_CREDENTIALS_PATH', 'GOOGLE_APPLICATION_CREDENTIALS']) vi.stubEnv(name, '')
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('Nano Banana credential preflight', () => {
    it('confines local image reads to public while keeping legacy public URLs', () => {
        const projectRoot = path.join(os.tmpdir(), 'banana-project')
        expect(resolveBananaLocalImagePath('/storage/character.png', projectRoot)).toBe(path.join(projectRoot, 'public', 'storage', 'character.png'))
        expect(resolveBananaLocalImagePath('product-guide/example.png', projectRoot)).toBe(path.join(projectRoot, 'public', 'product-guide', 'example.png'))
        expect(resolveBananaLocalImagePath('../hi-models.json', projectRoot)).toBeNull()
        expect(resolveBananaLocalImagePath(path.join(projectRoot, '.secrets', 'nano_banana.json'), projectRoot)).not.toBe(path.join(projectRoot, '.secrets', 'nano_banana.json'))
    })

    it('accepts an inline service account', () => {
        vi.stubEnv(
            'NANO_BANANA_SERVICE_ACCOUNT_JSON',
            JSON.stringify({
                client_email: 'image-generator@example.iam.gserviceaccount.com',
                project_id: 'example-project',
                private_key: 'fixture-private-key'
            })
        )

        expect(() => assertNanoBananaCredentialsConfigured()).not.toThrow()
    })

    it('passes the complete base64 service account and private-key newlines to Google auth', async () => {
        const account = {
            client_email: 'image-generator@example.iam.gserviceaccount.com',
            project_id: 'example-project',
            private_key: 'fixture-private-key\nsecond-fixture-line\n'
        }
        vi.stubEnv('NANO_BANANA_SERVICE_ACCOUNT_JSON_B64', Buffer.from(JSON.stringify(account)).toString('base64'))

        expect(() => assertNanoBananaCredentialsConfigured()).not.toThrow()
        await getGoogleAuthClient()
        expect(GoogleAuth).toHaveBeenCalledWith({ credentials: account, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
    })

    it('reports missing environment credentials without searching for root JSON', () => {
        expect(() => assertNanoBananaCredentialsConfigured()).toThrow(/NANO_BANANA_SERVICE_ACCOUNT_JSON_B64/)
    })

    it('rejects an incomplete service account before a job is created', () => {
        vi.stubEnv('NANO_BANANA_SERVICE_ACCOUNT_JSON', JSON.stringify({ project_id: 'example-project' }))

        expect(() => assertNanoBananaCredentialsConfigured()).toThrow(NanoBananaConfigurationError)
        expect(() => assertNanoBananaCredentialsConfigured()).toThrow(/client_email, project_id, or private_key/)
    })
})
