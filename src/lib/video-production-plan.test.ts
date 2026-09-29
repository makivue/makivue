import { describe, expect, it } from 'vitest'
import {
    VIDEO_ROUTING_RULE_VERSION,
    analyzeVideoShotConstraints,
    assessPreviousEndingFrameAnchor,
    assessSequentialContinuityDependency,
    buildVideoProviderConstraintPackage,
    estimateDialogueDurationSeconds,
    recommendVideoProvider,
    type VideoProviderFeedback
} from './video-production-plan'

describe('video production planning', () => {
    it('recommends native Seedance audio for emotional dialogue by default', () => {
        expect(recommendVideoProvider({ dialogue: '林晓薇：你终于来了。', shotType: 'close-up', characterCount: 1 }).provider).toBe('seedance')
    })

    it('keeps multi-speaker dialogue on native audio', () => {
        const result = recommendVideoProvider({ dialogue: '甲：快走！\n乙：等等我！', speakerCount: 2, characterCount: 2 })
        expect(result.provider).toBe('seedance')
        expect(result.reason).toContain('多位说话人')
    })

    it('keeps independent character-free environment shots on an available provider', () => {
        expect(recommendVideoProvider({ actionDesc: 'storm clouds roll over an ocean landscape', continuityMode: 'independent', characterCount: 0 }).provider).toBe('seedance')
        expect(recommendVideoProvider({ actionDesc: 'storm clouds roll over an ocean landscape', continuityMode: 'continuous', characterCount: 0 }).provider).toBe('seedance')
    })

    it('never restores retired Veo through production feedback', () => {
        expect(
            recommendVideoProvider(
                { actionDesc: 'storm clouds roll over an ocean landscape', continuityMode: 'independent', characterCount: 0 },
                { veo3: { attempts: 100, successRate: 1, averageDurationMs: 1, averageCostUsd: 0, averageQualityScore: 100 } }
            ).provider
        ).not.toBe('veo3')
    })

    it('never recommends retired Happy Horse for new generation', () => {
        expect(recommendVideoProvider({ shotType: 'close-up', actionDesc: '人物凝视镜头', characterCount: 1 }).provider).toBe('wan3')
    })

    it('marks high-dynamic shots as Kling comparison candidates', () => {
        const result = recommendVideoProvider({ actionDesc: '她狂奔后跳过栏杆并摔倒', characterCount: 1 })
        expect(result.provider).toBe('seedance')
        expect(result.comparisonProvider).toBe('kling')
    })

    it('distinguishes slight dialogue speedup from a required split', () => {
        const slight = analyzeVideoShotConstraints({ duration: 10, dialogue: `角色：${'你'.repeat(65)}` })
        const long = analyzeVideoShotConstraints({ duration: 10, dialogue: `角色：${'你'.repeat(80)}` })
        expect(slight.dialogueHandling).toBe('light_speedup')
        expect(long.dialogueHandling).toBe('split')
        expect(estimateDialogueDurationSeconds('角色：你好。')).toBeGreaterThan(0)
    })

    it('uses each selected model verified duration limit', () => {
        const dialogue = `角色：${'你'.repeat(40)}`
        expect(analyzeVideoShotConstraints({ provider: 'veo3', dialogue }).dialogueHandling).toBe('split')
        expect(analyzeVideoShotConstraints({ provider: 'seedance', dialogue })).toMatchObject({
            dialogueCapacitySeconds: 15,
            dialogueHandling: 'normal'
        })
    })

    it('treats HiModels Seedance frames as visual anchors while keeping Veo text-only', () => {
        expect(buildVideoProviderConstraintPackage('seedance-2.0-global', { duration: 8 })).toContain('supplied opening image')
        expect(buildVideoProviderConstraintPackage('seedance-2.0-global', { duration: 8 })).not.toContain('does not currently use the storyboard reference image')
        expect(buildVideoProviderConstraintPackage('veo3', { duration: 8 })).toContain('does not currently use the storyboard reference image')
        expect(buildVideoProviderConstraintPackage('MiniMax-H3', { duration: 15 })).toContain('MINIMAX H3')
        expect(buildVideoProviderConstraintPackage('MiniMax-H3', { duration: 15 })).not.toContain('HIMODELS SEEDANCE')
    })

    it('flags native dialogue combined with three or more action keyframes', () => {
        const result = analyzeVideoShotConstraints({ dialogue: '角色：快走！', keyframeCount: 4 })
        expect(result.keyframeDialogueConflict).toBe(true)
        expect(result.actionHandling).toBe('split')
        expect(result.warnings.join(' ')).toContain('中间帧')
    })

    it('recognizes numbered combat beats without relying on generic transition words', () => {
        const result = analyzeVideoShotConstraints({
            actionDesc: '他第一拳击中对方脸部，第二拳打向头部，第三拳从对方脑后打空。',
            characterCount: 2
        })
        expect(result).toMatchObject({
            actionHandling: 'split',
            actionStageCount: 3,
            recommendedActionSegments: 3
        })
    })

    it('does not hard-block an emotional shot with duplicated opening and ending text', () => {
        const result = analyzeVideoShotConstraints({
            actionDesc: 'Opening state: 老秦头抓住青年的手，随后闭眼，手无力垂落。; Ending state: 老秦头抓住青年的手，随后闭眼，青年哭着摇晃老秦头。',
            imagePrompt: '老秦头抓住青年的手，随后闭眼，青年哭着摇晃老秦头。'
        })
        expect(result.complexActionDetected).toBe(false)
        expect(result.actionHandling).toBe('normal')
    })

    it('does not use generic transition words or weather as a hard action-split gate', () => {
        const result = analyzeVideoShotConstraints({
            actionDesc: '暴雨落下，随后闪电亮起，然后人物抬头。',
            imagePrompt: '暴雨、闪电、人物抬头'
        })
        expect(result.complexActionDetected).toBe(false)
    })

    it('only accepts a previous ending-frame anchor for a safe exact continuity set', () => {
        const previous = { order: 1, sceneId: 7n, continuityMode: 'independent', continuityGroup: 2, characterIds: [11n] }
        const current = { order: 2, sceneId: 7n, continuityMode: 'continuous', continuityGroup: 2, characterIds: [11n] }
        expect(assessPreviousEndingFrameAnchor(previous, current).eligible).toBe(true)
        expect(assessPreviousEndingFrameAnchor(previous, { ...current, characterIds: [11n, 12n] }).eligible).toBe(false)
        expect(assessPreviousEndingFrameAnchor(previous, { ...current, actionDesc: '次日继续' }).eligible).toBe(false)
    })

    it('uses a state-only anchor for ordinary reverse shots with a changed visible cast', () => {
        const previous = { order: 1, sceneId: 7n, continuityMode: 'independent', continuityGroup: 2, characterIds: [11n] }
        const current = { order: 2, sceneId: 7n, continuityMode: 'stateful', continuityGroup: 2, characterIds: [12n] }
        expect(assessPreviousEndingFrameAnchor(previous, current)).toMatchObject({ eligible: true, anchorKind: 'state' })
        expect(assessPreviousEndingFrameAnchor(previous, { ...current, sceneId: 8n }).eligible).toBe(false)
    })

    it('serializes only strict pixel-continuous boundary handoffs', () => {
        const previous = {
            order: 1,
            sceneId: 7n,
            sceneTimeOfDay: 'night',
            continuityGroup: 2,
            characterIds: [11n],
            actionDesc: 'Opening state: 甲抬手; Ending state: 甲右拳停在乙左脸前'
        }
        const current = {
            order: 2,
            sceneId: 7n,
            sceneTimeOfDay: 'night',
            continuityMode: 'continuous',
            continuityGroup: 2,
            characterIds: [11n],
            actionDesc: 'Opening state: 甲右拳停在乙左脸前; Ending state: 甲收拳'
        }

        expect(assessSequentialContinuityDependency(previous, current)).toMatchObject({ sequential: true, confidence: 'strict' })
        expect(assessSequentialContinuityDependency(previous, { ...current, characterIds: [11n, 12n] }).sequential).toBe(true)
        expect(assessSequentialContinuityDependency(previous, { ...current, continuityMode: 'stateful' }).sequential).toBe(false)
        expect(assessSequentialContinuityDependency(previous, { ...current, actionDesc: 'Opening state: 甲已经收拳; Ending state: 甲转身' }).sequential).toBe(false)
        expect(assessSequentialContinuityDependency(previous, { ...current, continuityGroup: null }).sequential).toBe(false)
    })

    it('builds provider-specific constraint packages on top of common quality locks', () => {
        expect(buildVideoProviderConstraintPackage('seedance', {}).toLowerCase()).toContain('seedance')
        expect(buildVideoProviderConstraintPackage('seedance25', {})).toContain('SEEDANCE 2.5')
        expect(buildVideoProviderConstraintPackage('seedance25', {})).toContain('observable changes')
        expect(buildVideoProviderConstraintPackage('wanx', { dialogue: '你好' })).toContain('HAPPYHORSE 1.1 VISUAL-ONLY PATH')
        expect(buildVideoProviderConstraintPackage('veo3', {})).toContain('does not currently use')
    })

    it('does not change the rule recommendation when the alternative has fewer than five samples', () => {
        const feedback: VideoProviderFeedback = {
            seedance: { attempts: 5, successRate: 0.5, averageDurationMs: 600_000, averageCostUsd: 1, averageQualityScore: 50 },
            wanx: { attempts: 4, successRate: 1, averageDurationMs: 10_000, averageCostUsd: 0.01, averageQualityScore: 100 }
        }
        const result = recommendVideoProvider({ actionDesc: 'the character walks calmly from the table to the window', characterCount: 1 }, feedback)
        expect(result.provider).toBe('seedance')
        expect(result.ruleVersion).toBe(VIDEO_ROUTING_RULE_VERSION)
    })

    it('uses a clearly better provider only after both feedback confidence and score thresholds are met', () => {
        const feedback: VideoProviderFeedback = {
            seedance: { attempts: 5, successRate: 0.5, averageDurationMs: 600_000, averageCostUsd: 1, averageQualityScore: 50 },
            wan3: { attempts: 6, successRate: 1, averageDurationMs: 30_000, averageCostUsd: 0.05, averageQualityScore: 95 }
        }
        const result = recommendVideoProvider({ actionDesc: 'the character walks calmly from the table to the window', characterCount: 1 }, feedback)
        expect(result.provider).toBe('wan3')
        expect(result.feedbackSummary?.attempts).toBe(6)
    })

    it('never lets feedback route multi-speaker native dialogue to an unsupported provider', () => {
        const feedback: VideoProviderFeedback = {
            seedance: { attempts: 5, successRate: 0.1, averageDurationMs: 600_000, averageCostUsd: 1, averageQualityScore: 20 },
            wanx: { attempts: 100, successRate: 1, averageDurationMs: 10_000, averageCostUsd: 0.01, averageQualityScore: 100 },
            veo3: { attempts: 100, successRate: 1, averageDurationMs: 10_000, averageCostUsd: 0.01, averageQualityScore: 100 }
        }
        expect(recommendVideoProvider({ dialogue: '甲：快走！\n乙：等等我！', speakerCount: 2, characterCount: 2 }, feedback).provider).toBe('seedance')
    })
})
