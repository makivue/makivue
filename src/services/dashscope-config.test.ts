import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDashScopeConfig } from './dashscope-config'

afterEach(() => vi.unstubAllEnvs())

describe('DashScope credentials', () => {
    it('prefers the current DashScope key when both names exist', () => {
        vi.stubEnv('DASHSCOPE_API_KEY', 'current-key')
        vi.stubEnv('HAPPY_HORSE_API_KEY', 'legacy-key')
        expect(getDashScopeConfig().apiKey).toBe('current-key')
    })

    it('rejects the legacy internal variable when the personal key is absent', () => {
        vi.stubEnv('DASHSCOPE_API_KEY', '')
        vi.stubEnv('HAPPY_HORSE_API_KEY', 'legacy-key')
        expect(getDashScopeConfig().apiKey).toBeNull()
    })
})
