import { describe, expect, it, vi } from 'vitest'
import { buildSetupCharacterCandidates, syncSetupCharactersInTransaction } from './setup-characters'

describe('setup character synchronization', () => {
    it('deduplicates aliases by canonical name and marks candidates with provenance', () => {
        const candidates = buildSetupCharacterCandidates({
            mainCharacters: [{ name: '阿 · 青', role: '主角', persona: '谨慎' }],
            supportingCharacters: [{ name: '阿青', role: '朋友' }]
        })
        expect(candidates).toHaveLength(1)
        expect(candidates[0]).toMatchObject({ canonicalName: '阿青', sourceType: 'novel_setup', confirmationStatus: 'candidate' })
    })

    it('keeps a short role unchanged', () => {
        const [candidate] = buildSetupCharacterCandidates({ mainCharacters: [{ name: '阿青', role: '女主角' }] })
        expect(candidate.role).toBe('女主角')
        expect(candidate.roleDetail).toBeNull()
    })

    it('stores a long role as a concise label and preserves its detail in personality', () => {
        const longRole = `女主角，${'背负家族秘密并寻找真相'.repeat(15)}`
        const [candidate] = buildSetupCharacterCandidates({ mainCharacters: [{ name: '阿青', role: longRole, persona: '沉着果断' }] })

        expect(candidate.role).toBe('女主角')
        expect(Array.from(candidate.role).length).toBeLessThanOrEqual(50)
        expect(candidate.personality).toContain('沉着果断')
        expect(candidate.personality).toContain(`角色定位补充：${longRole}`)
    })

    it('uses group fallbacks and bounds every varchar-backed character field', () => {
        const candidates = buildSetupCharacterCandidates({
            mainCharacters: [{ name: '名'.repeat(120), age: '2'.repeat(30), gender: '未定义'.repeat(10) }],
            supportingCharacters: [{ name: '小雨' }]
        })

        expect(Array.from(candidates[0].name).length).toBe(100)
        expect(Array.from(candidates[0].canonicalName).length).toBeLessThanOrEqual(100)
        expect(Array.from(candidates[0].age ?? '').length).toBe(20)
        expect(Array.from(candidates[0].gender ?? '').length).toBe(20)
        expect(candidates.map(candidate => candidate.role)).toEqual(['主要角色', '配角'])
    })

    it('applies the normalized role when synchronizing an existing character', async () => {
        const update = vi.fn().mockResolvedValue({})
        const tx = {
            character: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 1n,
                    name: '阿青',
                    canonicalName: '阿青',
                    aliases: ['阿青'],
                    role: null,
                    age: null,
                    gender: null,
                    personality: '谨慎',
                    appearancePrompt: null,
                    sourceType: null
                }]),
                create: vi.fn(),
                update
            }
        } as unknown as Parameters<typeof syncSetupCharactersInTransaction>[0]

        await syncSetupCharactersInTransaction(tx, 1n, {
            supportingCharacters: [{ name: '阿青', role: `反派，${'控制欲极强'.repeat(30)}` }]
        })

        expect(update).toHaveBeenCalledOnce()
        expect(update.mock.calls[0][0].data.role).toBe('反派')
        expect(update.mock.calls[0][0].data.personality).toContain('角色定位补充：反派，')
    })
})
