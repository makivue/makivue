import { describe, expect, it } from 'vitest'
import { deriveScriptCharacterScope, findActingOrSpeakingCharacterNames, findMentionedCharacterNames, sanitizeOutOfScopeCharacterReferences } from './script-character-scope'

describe('script character scope', () => {
    const characters = [
        { name: '小明', canonicalName: '小明', aliases: ['明哥'] },
        { name: '赵总', canonicalName: '赵总', aliases: null },
        { name: '老K', canonicalName: '老k', aliases: ['K老板'] }
    ]

    it('does not treat the whole project roster as the current episode cast', () => {
        const scope = deriveScriptCharacterScope({
            characters,
            chapterTitle: '古法时代的降维打击',
            chapterSynopsis: '小明重生后解决公司危机',
            chapterContent: '小明走进机房。赵总看完结果后向他道歉。'
        })

        expect(scope.allowedCharacterNames).toEqual(['小明', '赵总'])
        expect(scope.referenceOnlyCharacterNames).toEqual([])
        expect(scope.outOfScopeCharacterNames).toContain('老K')
    })

    it('allows a project character when the current source uses an alias', () => {
        const scope = deriveScriptCharacterScope({
            characters,
            chapterContent: '老k推门走进机房，抬手关闭了警报。'
        })

        expect(scope.allowedCharacterNames).toEqual(['老K'])
        expect(scope.outOfScopeCharacterNames).not.toContain('老K')
    })

    it('uses only the current episode state as supplemental casting evidence', () => {
        const currentEpisodeState = {
            openingState: '赵总站在门口等待结果。',
            continuityBridge: '下一集老K将发动攻击。'
        }
        const scope = deriveScriptCharacterScope({
            characters,
            chapterContent: '机房警报响起。',
            currentEpisodeState
        })

        expect(scope.allowedCharacterNames).toEqual(['赵总'])
        expect(scope.outOfScopeCharacterNames).toEqual(expect.arrayContaining(['小明', '老K']))
    })

    it('keeps a codename mention as reference-only instead of casting that character', () => {
        const scope = deriveScriptCharacterScope({
            characters,
            chapterContent: '【警告：捕获到恶意特征码，幕后实体代号：老K。】小明猛地抬头。'
        })

        expect(scope.allowedCharacterNames).toEqual(['小明'])
        expect(scope.referenceOnlyCharacterNames).toEqual(expect.arrayContaining(['老K', 'K老板']))
        expect(scope.outOfScopeCharacterNames).not.toContain('老K')
    })

    it('finds out-of-scope names case-insensitively in all script prose', () => {
        expect(findMentionedCharacterNames('（动作：老k推门而入）', ['老K', '林晓'])).toEqual(['老K'])
    })

    it('removes out-of-scope names from cross-episode reference context', () => {
        const sanitized = sanitizeOutOfScopeCharacterReferences('下一集老K和K老板将出现，林晓留在本集。', ['老K', 'K老板'])

        expect(sanitized).not.toMatch(/老k|K老板/iu)
        expect(sanitized).toContain('林晓')
    })

    it('distinguishes a reference-only codename from an acting or speaking character', () => {
        const referenced = '（动作：小明看向写着“幕后代号：老K”的终端）'
        const acting = '（动作：老K从专家席站起）\n老K：快修复系统！'

        expect(findActingOrSpeakingCharacterNames(referenced, ['老K'])).toEqual([])
        expect(findActingOrSpeakingCharacterNames(acting, ['老K'])).toEqual(['老K'])
    })
})
