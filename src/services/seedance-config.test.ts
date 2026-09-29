import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: mocks.findUnique } } }))

import { getSeedanceConfig } from './seedance-config'
import { SEEDANCE_20_BASE_URL, SEEDANCE_20_ENDPOINT_ID, SEEDANCE_25_BASE_URL, SEEDANCE_25_ENDPOINT_ID } from '@/lib/provider-capabilities'

describe('Seedance runtime credentials', () => {
    beforeEach(() => {
        mocks.findUnique.mockReset().mockResolvedValue(null)
        vi.stubEnv('VOLCENGINE_ARK_API_KEY', '')
        vi.stubEnv('ARK_API_KEY', '')
        vi.stubEnv('BYTEPLUS_ARK_API_KEY', '')
        vi.stubEnv('SEEDANCE_API_KEY', 'personal-seedance-key')
        for (const key of ['SEEDANCE_20_BASE_URL', 'SEEDANCE_20_MODEL', 'SEEDANCE_25_BASE_URL', 'SEEDANCE_25_MODEL']) vi.stubEnv(key, '')
    })

    afterEach(() => {
        expect(mocks.findUnique).not.toHaveBeenCalled()
        vi.unstubAllEnvs()
    })

    it.each([
        ['seedance', SEEDANCE_20_BASE_URL, SEEDANCE_20_ENDPOINT_ID],
        ['seedance25', SEEDANCE_25_BASE_URL, SEEDANCE_25_ENDPOINT_ID]
    ] as const)('uses the personal credential with the correct endpoint for %s', async (variant, baseUrl, modelName) => {
        expect(await getSeedanceConfig(variant)).toEqual({ apiKey: 'personal-seedance-key', baseUrl, modelName, extra: null })
    })

    it('ignores old database credentials and extra settings', async () => {
        mocks.findUnique.mockResolvedValue({ apiKey: 'settings-key', extra: '{"imageModel":"saved-model"}' })
        expect(await getSeedanceConfig()).toMatchObject({ apiKey: 'personal-seedance-key', extra: null })
    })

    it.each(['VOLCENGINE_ARK_API_KEY', 'ARK_API_KEY', 'BYTEPLUS_ARK_API_KEY'])('ignores the old %s override without reading Settings', async key => {
        mocks.findUnique.mockResolvedValue({ apiKey: 'settings-key', extra: 'saved-extra' })
        vi.stubEnv(key, 'runtime-override')
        expect(await getSeedanceConfig()).toMatchObject({ apiKey: 'personal-seedance-key', extra: null })
        vi.stubEnv('SEEDANCE_API_KEY', '')
        expect(await getSeedanceConfig()).toBeNull()
    })

    it('does not attach incomplete database settings to the default credential', async () => {
        mocks.findUnique.mockResolvedValue({ apiKey: null, extra: 'unrelated-extra' })
        expect(await getSeedanceConfig()).toMatchObject({ apiKey: 'personal-seedance-key', extra: null })
    })

    it('returns no config if all credentials are missing', async () => {
        vi.stubEnv('SEEDANCE_API_KEY', '  ')
        expect(await getSeedanceConfig()).toBeNull()
    })

    it('uses independently configurable endpoints for both variants', async () => {
        vi.stubEnv('SEEDANCE_20_BASE_URL', 'https://seedance20.example/')
        vi.stubEnv('SEEDANCE_20_MODEL', 'ep-custom-20')
        vi.stubEnv('SEEDANCE_25_BASE_URL', 'https://seedance25.example/')
        vi.stubEnv('SEEDANCE_25_MODEL', 'ep-custom-25')
        expect(await getSeedanceConfig()).toMatchObject({ baseUrl: 'https://seedance20.example', modelName: 'ep-custom-20' })
        expect(await getSeedanceConfig('seedance25')).toMatchObject({ baseUrl: 'https://seedance25.example', modelName: 'ep-custom-25' })
    })
})
