import { describe, expect, it } from 'vitest'
import { normalizeProfileAvatarUrl, normalizeProfileDisplayName, PROFILE_DISPLAY_NAME_MAX_LENGTH } from './profile'

describe('profile validation', () => {
    it('requires a non-empty display name and trims it', () => {
        expect(normalizeProfileDisplayName('  Alice  ')).toBe('Alice')
        expect(normalizeProfileDisplayName('   ')).toBeNull()
        expect(normalizeProfileDisplayName('名'.repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH + 1))).toBeNull()
    })

    it('accepts only non-empty HTTP avatar URLs', () => {
        expect(normalizeProfileAvatarUrl('https://cdn.example/avatar.png')).toBe('https://cdn.example/avatar.png')
        expect(normalizeProfileAvatarUrl('javascript:alert(1)')).toBeNull()
        expect(normalizeProfileAvatarUrl('')).toBeNull()
    })
})
