import { describe, expect, it } from 'vitest'
import { hasRecoverableVideoCheckpoint } from './generation-checkpoint-recovery'

describe('generation checkpoint recovery', () => {
    it.each([
        'wan3',
        'wan3prime',
        'wanx',
        'veo3',
        'seedance',
        'seedance25',
        'seedance-2.0-global',
        'veo-3.1-generate-001',
        'veo-3.1-fast-generate-001',
        'veo-3.1-lite-generate-001'
    ])('recognizes a single historical %s upstream task', provider => {
        expect(hasRecoverableVideoCheckpoint({ type: 'video', provider, taskId: 'task-123' })).toBe(true)
    })

    it('does not claim jobs without a durable upstream task id', () => {
        expect(hasRecoverableVideoCheckpoint({ type: 'video', provider: 'wan3', taskId: null })).toBe(false)
    })

    it('does not resume segmented jobs whose downloaded segments were pod-local', () => {
        expect(hasRecoverableVideoCheckpoint({ type: 'video', provider: 'seedance25', taskId: 'segment-1,segment-2' })).toBe(false)
    })
})
