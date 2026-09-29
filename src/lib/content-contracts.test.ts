import { describe, expect, it } from 'vitest'
import { getEpisodeFormatSpec } from './novel'
import { countContentUnits, getChapterMinimumUnits, preferChapterRepair, validateEpisodeStatePlan, validateOutlineContract, validateScriptContract } from './content-contracts'

describe('content contracts', () => {
    it('counts CJK characters and latin words with one stable metric', () => {
        expect(countContentUnits('你好 world again')).toBe(4)
    })

    it('keeps chapter repair monotonic while the draft is below the hard minimum', () => {
        expect(getChapterMinimumUnits(2000)).toBe(1700)
        const current = '旧'.repeat(1200)
        expect(preferChapterRepair(current, '新'.repeat(853), 2000)).toBe(current)
        expect(preferChapterRepair(current, '新'.repeat(1800), 2000)).toBe('新'.repeat(1800))
    })

    it('rejects incomplete episode state plans', () => {
        const issues = validateEpisodeStatePlan([{ episodeNumber: 1, openingState: '门口', endingState: '', setupPayoffs: ['   '] }], 2)
        expect(issues.map(issue => issue.code)).toContain('missing_episode')
        expect(issues.some(issue => issue.path.endsWith('endingState'))).toBe(true)
        expect(issues.map(issue => issue.code)).toContain('invalid_setup_payoff')
    })

    it('requires complete outline fields and canonical intensity', () => {
        const issues = validateOutlineContract([{ chapterNumber: 1, title: '开端', synopsis: '太短', intensity: 11 }], [1])
        expect(issues.map(issue => issue.code)).toContain('too_short')
        expect(issues.map(issue => issue.code)).toContain('range')
        expect(issues.some(issue => issue.path.endsWith('protagonistGoal'))).toBe(true)
        expect(issues.map(issue => issue.code)).toContain('invalid_setup_payoff')
    })

    it('rejects incomplete scripts and unknown speakers', () => {
        const issues = validateScriptContract({
            script: '陌生人：你好',
            spec: getEpisodeFormatSpec('micro'),
            allowedCharacterNames: ['阿青']
        })
        const codes = issues.map(issue => issue.code)
        expect(codes).toEqual(expect.arrayContaining(['too_few_scenes', 'unknown_speaker']))
        expect(codes).not.toContain('too_short')
    })

    it('allows registered character inner voices but still rejects unknown ones', () => {
        const base = { spec: getEpisodeFormatSpec('micro'), allowedCharacterNames: ['阿青'] }
        expect(validateScriptContract({ ...base, script: '阿青（内心）：他还是来了。' }).map(issue => issue.code)).not.toContain('unknown_speaker')
        expect(validateScriptContract({ ...base, script: '陌生人（内心）：不能让他发现。' }).map(issue => issue.code)).toContain('unknown_speaker')
    })

    it('rejects an out-of-scope project character in action prose as well as dialogue', () => {
        const issues = validateScriptContract({
            script: '【场景：机房】\n（动作：老K推门而入）\n小明：系统恢复了。',
            spec: getEpisodeFormatSpec('micro'),
            allowedCharacterNames: ['小明'],
            outOfScopeCharacterNames: ['老K', '林晓'],
            title: '系统重启',
            synopsis: '小明独自修复系统'
        })

        expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'out_of_scope_character', message: expect.stringContaining('老K') })]))
    })

    it('allows a codename reference but rejects turning it into an actor', () => {
        const base = {
            spec: getEpisodeFormatSpec('micro'),
            allowedCharacterNames: ['小明'],
            referenceOnlyCharacterNames: ['老K'],
            title: '系统警报',
            synopsis: '小明发现幕后代号'
        }
        const referenced = validateScriptContract({ ...base, script: '【场景：机房】\n（动作：小明看向写着“幕后代号：老K”的终端）\n小明：找到线索了。' })
        const acting = validateScriptContract({ ...base, script: '【场景：机房】\n（动作：老K从专家席站起）\n老K：快修复系统！' })

        expect(referenced.map(issue => issue.code)).not.toContain('reference_only_character_acted')
        expect(acting.map(issue => issue.code)).toContain('reference_only_character_acted')
    })

    it('requires shootable scene, character, action, and expression details in scripts', () => {
        const spec = getEpisodeFormatSpec('micro')
        const unstructuredIssues = validateScriptContract({
            script: '【场景：客厅/日/内】\n（Opening state: 阿青站在门边）\n阿青：我回来了。\n【场景：厨房/日/内】\n（Ending state: 阿青坐在桌边）',
            spec,
            allowedCharacterNames: ['阿青'],
            title: '回家',
            synopsis: '阿青回到家中'
        })
        expect(unstructuredIssues.map(issue => issue.code)).toEqual(
            expect.arrayContaining(['scene_description_missing', 'character_state_missing', 'action_beat_missing', 'expression_detail_missing'])
        )

        const structuredIssues = validateScriptContract({
            script: '【场景：客厅/日/内】\n（场景描述：午后阳光落在门边，鞋柜上放着一封信。）\n（Opening state: 阿青穿灰色外套站在门边，右手握住门把手。）\n（表情：看到信封后，阿青视线停住，眉心收紧，嘴唇微张。）\n（动作：阿青从门边走到鞋柜前，伸出左手拿起信封。）\n阿青：我回来了。\n【场景：厨房/日/内】\n（场景描述：狭窄厨房亮着顶灯，木桌上放着一杯未动的水。）\n（人物状态：阿青仍穿灰色外套，站在木桌左侧，左手拿着信封。）\n（动作：阿青拉开木椅坐下，将信封平放在水杯旁。）\n（Ending state: 阿青坐在桌边，左手压住信封，目光落在封口上。）',
            spec,
            allowedCharacterNames: ['阿青'],
            title: '回家',
            synopsis: '阿青回到家中'
        })
        const structuredCodes = structuredIssues.map(issue => issue.code)
        for (const code of ['scene_description_missing', 'character_state_missing', 'action_beat_missing', 'expression_detail_missing']) {
            expect(structuredCodes).not.toContain(code)
        }
    })
})
