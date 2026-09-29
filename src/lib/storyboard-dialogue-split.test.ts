import { describe, expect, it } from 'vitest'
import { expandDialogueStoryboardDrafts, splitDialogueForWan } from './storyboard-dialogue-split'

describe('Wan dialogue storyboard splitting', () => {
    it('splits a measured 21-second line into safe semantic parts and repeats the speaker', () => {
        const dialogue = '理查德：作为王室目前唯一的合法长辈，我，理查德，将全面接管王室集团与城市防务！我宣布，剥夺伊丽莎白的一切继承权！即刻起，全城通缉这名叛国弑父的罪人！死活不论！'
        const parts = splitDialogueForWan(dialogue, { actualDurationSeconds: 21 })
        expect(parts).toHaveLength(2)
        expect(parts.every(part => part.dialogue.startsWith('理查德：'))).toBe(true)
        expect(parts.every(part => part.estimatedSeconds <= 15)).toBe(true)
        expect(parts.map(part => part.speech).join('')).toBe(dialogue.replace(/^理查德：/, ''))
    })

    it('keeps a short line in one shot', () => {
        expect(splitDialogueForWan('林晓薇：你终于来了。', { actualDurationSeconds: 3 })).toHaveLength(1)
    })

    it('keeps a 16.1-second line because pitch-preserving 1.12x fitting remains natural', () => {
        expect(splitDialogueForWan('林晓薇：这是一段稍微超过十五秒、但仍然可以自然轻微加速的台词。', { actualDurationSeconds: 16.1 })).toHaveLength(1)
    })

    it('re-splits an unbalanced long clause so no resulting shot remains oversized', () => {
        const parts = splitDialogueForWan(`理查德：${'很长的一段连续宣言'.repeat(18)}！好。`, { actualDurationSeconds: 32 })
        expect(parts.length).toBeGreaterThan(2)
        expect(parts.every(part => part.estimatedSeconds <= 15)).toBe(true)
    })

    it('keeps a coherent line in one Seedance 30-second shot but splits it for shorter providers', () => {
        const draft = [{ order: 1, duration: 24, dialogue: `角色：${'自然连续对白'.repeat(15)}` }]
        expect(expandDialogueStoryboardDrafts(draft, { maximumSeconds: 30 })).toHaveLength(1)
        expect(expandDialogueStoryboardDrafts(draft, { maximumSeconds: 8 }).length).toBeGreaterThan(1)
    })
})
