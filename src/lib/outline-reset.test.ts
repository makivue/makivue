import { describe, expect, it, vi } from 'vitest'
import { resetOutlineProgress } from './outline-reset'

const response = (body: unknown, status = 200) => Response.json(body, { status })

describe('user-triggered outline reset', () => {
    it('executes the reset after preparation and waits for the execution result', async () => {
        const fetchRequest = vi
            .fn()
            .mockResolvedValueOnce(response({ success: true, data: { confirmationRequired: true, confirmationToken: 'confirmed-version' } }))
            .mockResolvedValueOnce(response({ success: true, data: { episodes: 12, characters: 5, scenes: 16 } }))
        expect(await resetOutlineProgress('project', fetchRequest)).toEqual({ episodes: 12, characters: 5, scenes: 16 })
        expect(JSON.parse(fetchRequest.mock.calls[1][1].body)).toEqual({ confirmationToken: 'confirmed-version' })
    })

    it('returns through the same completion path when a legacy server resets in one request', async () => {
        const fetchRequest = vi.fn().mockResolvedValue(response({ success: true, data: { episodes: 12, storyboards: 30 } }))
        expect(await resetOutlineProgress('project', fetchRequest)).toEqual({ episodes: 12, storyboards: 30 })
        expect(fetchRequest).toHaveBeenCalledOnce()
    })

    it('supports legacy preparation envelopes without treating them as execution', async () => {
        const fetchRequest = vi
            .fn()
            .mockResolvedValueOnce(response({ confirmationRequired: true, confirmationToken: 'token' }, 409))
            .mockResolvedValueOnce(response({ success: true, data: { episodes: 12 } }))
        expect(await resetOutlineProgress('project', fetchRequest)).toEqual({ episodes: 12 })
        expect(fetchRequest).toHaveBeenCalledTimes(2)
    })

    it('refuses to start a new outline when execution only returns another challenge', async () => {
        const fetchRequest = vi.fn().mockImplementation(async () => response({ success: true, data: { confirmationRequired: true, confirmationToken: 'changed-version' } }))
        await expect(resetOutlineProgress('project', fetchRequest)).rejects.toThrow('尚未清空旧内容')
    })

    it('propagates failed execution instead of allowing the workflow to advance', async () => {
        const fetchRequest = vi
            .fn()
            .mockResolvedValueOnce(response({ success: true, data: { confirmationRequired: true, confirmationToken: 'token' } }))
            .mockResolvedValueOnce(response({ success: false, error: '项目进度已变化' }, 409))
        await expect(resetOutlineProgress('project', fetchRequest)).rejects.toThrow('项目进度已变化')
    })
})
