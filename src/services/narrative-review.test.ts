import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNarrativeReview, reviewNarrativeContent } from './narrative-review'
import { BillingError } from '@/lib/billing-error'

const { chatJSON } = vi.hoisted(() => ({ chatJSON: vi.fn() }))
vi.mock('./llm', async importOriginal => ({ ...(await importOriginal<typeof import('./llm')>()), chatJSON }))

const content = '阿青交出信封，小雨接过信封。'
const result = {
    issues: [],
    quality: {
        causality: 85,
        characterAgency: 80,
        escalation: 78,
        emotionalProgression: 82,
        dialogueSubtext: 75,
        hookStrength: 88,
        visualDramatization: 84,
        notes: []
    },
    facts: {
        summary: content,
        openingState: '阿青持有信封',
        endingState: '小雨持有信封',
        characterStateChanges: '信封归属改变',
        continuityBridge: '从交接动作继续',
        events: [{ description: '小雨获得信封', evidence: '小雨接过信封' }]
    }
}

describe('narrative review evidence', () => {
    it('stores observed facts with a source fingerprint', () => {
        const review = parseNarrativeReview(result, content, 1, 'script')
        expect(review.facts.kind).toBe('observed')
        expect(review.facts.sourceHash).toMatch(/^[a-f0-9]{64}$/)
        expect(review.facts.events).toEqual(result.facts.events)
    })

    it('refuses facts whose quoted evidence is absent from the actual text', () => {
        expect(() => parseNarrativeReview({ ...result, facts: { ...result.facts, events: [{ description: '信封被毁', evidence: '信封烧成灰烬' }] } }, content, 1, 'chapter')).toThrow('证据未出现')
    })

    it.each([
        { source: 'Maya whispered, “I can’t leave.”', quote: '"I can\'t leave."', expected: '“I can’t leave.”' },
        { source: '🔑 Jose\u0301 handed her the key.', quote: 'José handed her the key.', expected: 'Jose\u0301 handed her the key.' },
        { source: 'She took the key.\n\tThen she left.', quote: 'She took the key. Then she left.', expected: 'She took the key.\n\tThen she left.' }
    ])('matches harmless typography and stores verbatim evidence: $source', ({ source, quote, expected }) => {
        const review = parseNarrativeReview({ ...result, facts: { ...result.facts, events: [{ description: 'Observed event', evidence: quote }] } }, source, 1, 'chapter')
        expect(review.facts.events[0].evidence).toBe(expected)
        expect(source.includes(review.facts.events[0].evidence)).toBe(true)
    })

    it.each(['Maya opened the door.', 'Maya did open the door.', 'Maya did not open the door. ... She left.', 'Maya did not open the door. She left.'])(
        'still rejects paraphrased, contradicted or spliced evidence: %s',
        evidence => {
            const source = 'Maya did not open the door. She waited for the guard. She left.'
            expect(() => parseNarrativeReview({ ...result, facts: { ...result.facts, events: [{ description: 'Observed event', evidence }] } }, source, 1, 'chapter')).toThrow('证据未出现')
        }
    )

    it('keeps substantive contradictions actionable instead of silently passing them', () => {
        const review = parseNarrativeReview({ ...result, issues: [{ path: '场景2', message: '小雨尚未收到信封却已打开信封；先落实交接。' }] }, content, 1, 'script')
        expect(review.issues).toEqual([{ path: '场景2', code: 'narrative_conflict', message: '小雨尚未收到信封却已打开信封；先落实交接。' }])
    })

    it('turns weak dramatic dimensions into targeted repair issues', () => {
        const review = parseNarrativeReview(
            {
                ...result,
                quality: {
                    causality: 85,
                    characterAgency: 45,
                    escalation: 80,
                    emotionalProgression: 75,
                    dialogueSubtext: 55,
                    hookStrength: 82,
                    visualDramatization: 90,
                    notes: ['主角只被动接收消息', '对白直接解释剧情']
                }
            },
            content,
            1,
            'script'
        )
        expect(review.quality?.overall).toBe(73)
        expect(review.issues.filter(issue => issue.code === 'dramatic_quality')).toHaveLength(2)
    })
})

describe('narrative review recovery', () => {
    const params = { stage: 'chapter' as const, episodeNumber: 1, content, source: '交接信封', setup: {} }
    beforeEach(() => {
        chatJSON.mockReset()
        vi.useFakeTimers()
    })
    afterEach(() => vi.useRealTimers())

    it('retries invalid evidence against the same draft and supplies specific validation feedback', async () => {
        chatJSON.mockResolvedValueOnce({ ...result, facts: { ...result.facts, events: [{ description: '收到信封', evidence: '收到了一封信' }] } }).mockResolvedValueOnce(result)
        const review = await reviewNarrativeContent(params)
        expect(chatJSON).toHaveBeenCalledTimes(2)
        expect(chatJSON.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('facts.events[0].evidence') })]))
        expect(chatJSON.mock.calls[1][0].at(-1).content).toContain(JSON.stringify('收到了一封信'))
        expect(chatJSON.mock.calls[1][0][1].content).toContain(content)
        expect(review.facts.events).toEqual(result.facts.events)
    })

    it('does not spend another model call when evidence differs only in English quotation marks', async () => {
        const source = '“I can’t leave,” Maya said.'
        chatJSON.mockResolvedValue({ ...result, facts: { ...result.facts, events: [{ description: 'Maya speaks', evidence: '"I can\'t leave," Maya said.' }] } })
        const review = await reviewNarrativeContent({ ...params, content: source })
        expect(chatJSON).toHaveBeenCalledOnce()
        expect(review.facts.events[0].evidence).toBe(source)
    })

    it('does not accept fabricated facts when all validation retries fail', async () => {
        chatJSON.mockResolvedValue({ ...result, facts: { ...result.facts, events: [{ description: '信封被毁', evidence: '信封烧成灰烬' }] } })
        await expect(reviewNarrativeContent(params)).rejects.toThrow('证据未出现')
        expect(chatJSON).toHaveBeenCalledTimes(3)
    })

    it('recovers from a malformed review JSON response', async () => {
        chatJSON.mockRejectedValueOnce(new Error('模型返回的 JSON 格式异常，自动修复后仍无法解析')).mockResolvedValueOnce(result)
        expect((await reviewNarrativeContent(params)).facts.events).toEqual(result.facts.events)
        expect(chatJSON).toHaveBeenCalledTimes(2)
    })

    it('retries a temporary upstream failure without losing the draft', async () => {
        chatJSON.mockRejectedValueOnce(new Error('Gemini error 503: unavailable')).mockResolvedValueOnce(result)
        const pending = reviewNarrativeContent(params)
        await vi.runAllTimersAsync()
        expect((await pending).facts.events).toEqual(result.facts.events)
        expect(chatJSON).toHaveBeenCalledTimes(2)
    })

    it.each([new BillingError('可用金币不足'), new Error('Gemini Google 凭证已过期或权限不足')])('does not retry permanent errors: %s', async error => {
        chatJSON.mockRejectedValue(error)
        await expect(reviewNarrativeContent(params)).rejects.toBe(error)
        expect(chatJSON).toHaveBeenCalledOnce()
    })

    it('returns real story conflicts for revision instead of re-reviewing until one passes', async () => {
        chatJSON.mockResolvedValue({ ...result, issues: [{ path: '开场', message: '需要先交接信封' }] })
        expect((await reviewNarrativeContent(params)).issues).toHaveLength(1)
        expect(chatJSON).toHaveBeenCalledOnce()
    })
})
