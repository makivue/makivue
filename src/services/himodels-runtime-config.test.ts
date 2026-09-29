import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: mocks.findUnique } } }))

import { getHiModelsRuntimeConfig } from './himodels'

describe('personal HiModels API key selection', () => {
    beforeEach(() => {
        mocks.findUnique.mockReset().mockResolvedValue({ apiKey: 'saved-key', baseUrl: 'https://stale.example' })
        vi.stubEnv('HIMODELS_DEV_API_KEY', 'old-development-key')
        vi.stubEnv('HIMODELS_SHARED_API_KEY', 'old-shared-key')
        vi.stubEnv('HIMODELS_BASE_URL', 'https://configured.example/')
        vi.stubEnv('HIMODELS_API_KEY', '  personal-key  ')
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network calls allowed'))
    })

    afterEach(() => {
        expect(mocks.findUnique).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it.each(['development', 'test', 'production'])('uses only the personal key in %s', async nodeEnv => {
        vi.stubEnv('NODE_ENV', nodeEnv)
        expect(await getHiModelsRuntimeConfig()).toEqual({ apiKey: 'personal-key', baseUrl: 'https://configured.example' })
    })

    it.each(['development', 'test', 'production'])('rejects missing personal credentials despite old shared and saved keys in %s', async nodeEnv => {
        vi.stubEnv('NODE_ENV', nodeEnv)
        vi.stubEnv('HIMODELS_API_KEY', '   ')
        await expect(getHiModelsRuntimeConfig()).rejects.toThrow('请在 .env 填写自己的 HIMODELS_API_KEY')
    })
})
