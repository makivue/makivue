import { describe, expect, it } from 'vitest'
import {
    EPISODE_BATCH_REPEATED_FAILURE_LIMIT,
    presentEpisodeBatchFailure,
    repeatedEpisodeBatchFailureMessage
} from './episode-batch-failure-policy'
import { getGenerationErrorGuidance } from './generation-error-guidance'

describe('episode batch repeated failure policy', () => {
    it('turns a privacy provider payload into one actionable user message', () => {
        const raw = ['Seedance create error:', '{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation"}}'].join(' ')
        const result = presentEpisodeBatchFailure(new Error(raw))
        const guidance = getGenerationErrorGuidance(raw)
        expect(result.circuitKey).toBe('content_safety')
        expect(result.message).toBe(`${guidance.title}：${guidance.nextStep}`)
        expect(result.message).not.toContain('Seedance')
        expect(result.message).not.toContain('InputImageSensitiveContentDetected')
    })

    it('stops a repeated unrecoverable reason instead of failing every remaining shot', () => {
        const presentation = presentEpisodeBatchFailure(new Error('视频台词语言转换暂时未完成，请稍后重试或调整原声语言。'))
        expect(EPISODE_BATCH_REPEATED_FAILURE_LIMIT).toBe(3)
        expect(presentation.circuitKey).toBe('translation')
        expect(repeatedEpisodeBatchFailureMessage(presentation)).toContain(presentation.message)
    })

    it('does not open the circuit for an isolated unknown content error', () => {
        const raw = ['one', 'frame', 'failed', 'unexpectedly'].join(' ')
        expect(presentEpisodeBatchFailure(new Error(raw)).circuitKey).toBeUndefined()
    })

    it('preserves queue counts and limits if waiting eventually times out', () => {
        const raw = '视频生成队列等待超时：当前账号已有 20 个视频任务排队，队列上限为 20；一键生成等待 45 分钟仍无空位，请稍后继续。'
        const presentation = presentEpisodeBatchFailure(new Error(raw))
        expect(presentation.message).toBe(raw)
        expect(presentation.circuitKey).toBeUndefined()
    })
})
