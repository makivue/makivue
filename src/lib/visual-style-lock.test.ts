import { describe, expect, it } from 'vitest'
import { buildVisualStyleLock, getVisualStyleFamily, sanitizePromptForVisualStyle } from './visual-style-lock'

const modern = { key: 'modern-drama', label: '现代短剧写实', hint: '现代都市、办公室', imagePromptPrefix: 'modern urban live-action drama', negativePrompt: 'cartoon' }
const xianxia = { key: 'chinese-ink', label: '中国古风', hint: '仙侠古装', imagePromptPrefix: 'xianxia hanfu ink painting', negativePrompt: 'modern clothes' }

describe('visual style lock', () => {
    it('classifies modern and historical fantasy styles', () => {
        expect(getVisualStyleFamily(modern)).toBe('modern')
        expect(getVisualStyleFamily(xianxia)).toBe('historical-fantasy')
    })

    it('removes stale xianxia styling from modern prompts without removing subject/action', () => {
        const result = sanitizePromptForVisualStyle('女主穿汉服站在仙宫，抬手打开房门', modern)
        expect(result).toContain('女主')
        expect(result).toContain('抬手打开房门')
        expect(result).not.toMatch(/汉服|仙宫/)
    })

    it('keeps xianxia terms for a xianxia project', () => {
        expect(sanitizePromptForVisualStyle('hanfu heroine enters a cultivation sect', xianxia)).toContain('cultivation sect')
    })

    it('adds explicit incompatible-genre negatives for modern projects', () => {
        const lock = buildVisualStyleLock(modern)
        expect(lock.positive).toContain('present-day wardrobe')
        expect(lock.negative).toContain('xianxia')
        expect(lock.negative).toContain('hanfu')
    })
})
