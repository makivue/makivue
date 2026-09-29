import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { clientFetch } = vi.hoisted(() => ({ clientFetch: vi.fn() }))
vi.mock('./client-fetch', () => ({ clientFetch, readApiJson: (response: Response) => response.json() }))

import { pollChapterJob, startChapterJob } from './chapter-generation-client'

const chapter = { episodeId: '789', chapterContent: '已保存的正文' }
const response = (data: unknown, status = 200) => Response.json({ success: status < 400, data, error: status < 400 ? undefined : '接口暂时不可用' }, { status })

beforeEach(() => {
    clientFetch.mockReset()
    vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('chapter job client recovery', () => {
    it('survives network errors and a truncated gateway response by polling the same job', async () => {
        clientFetch
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(new Response('<html>Bad Gateway', { status: 502 }))
            .mockResolvedValueOnce(response({ phase: 'generating' }))
            .mockResolvedValueOnce(response({ phase: 'done', result: chapter }))
        const pending = pollChapterJob('456')
        await vi.runAllTimersAsync()
        expect(await pending).toEqual(chapter)
        expect(clientFetch).toHaveBeenCalledTimes(4)
        expect(clientFetch.mock.calls.every(([url, init]) => url === '/api/ai/chapter/status/456' && !init.method)).toBe(true)
    })

    it('keeps waiting when a healthy multi-pass chapter takes longer than ten minutes', async () => {
        const startedAt = Date.now()
        clientFetch.mockImplementation(async () => response(Date.now() - startedAt > 11 * 60_000 ? { phase: 'done', result: chapter } : { phase: 'generating' }))
        const pending = pollChapterJob('456')
        await vi.runAllTimersAsync()
        expect(await pending).toEqual(chapter)
    })

    it.each(['error', 'cancelled'])('immediately reports terminal %s without re-submitting generation', async phase => {
        clientFetch.mockResolvedValue(response({ phase, error: '原任务失败原因' }))
        await expect(pollChapterJob('456')).rejects.toThrow('原任务失败原因')
        expect(clientFetch).toHaveBeenCalledOnce()
    })

    it.each([401, 403, 404])('does not retry status HTTP %s', async status => {
        clientFetch.mockResolvedValue(response({}, status))
        await expect(pollChapterJob('456')).rejects.toThrow('接口暂时不可用')
        expect(clientFetch).toHaveBeenCalledOnce()
    })

    it('bounds repeated transport failures and tells the user the background job may still be running', async () => {
        clientFetch.mockRejectedValue(new TypeError('Failed to fetch'))
        const assertion = expect(pollChapterJob('456')).rejects.toThrow('后台任务可能仍在运行')
        await vi.runAllTimersAsync()
        await assertion
        expect(clientFetch).toHaveBeenCalledTimes(5)
    })

    it('reconnects after a lost task-start response body', async () => {
        clientFetch.mockResolvedValueOnce(new Response('')).mockResolvedValueOnce(response({ jobId: '456', resumed: true }))
        const pending = startChapterJob('789')
        await vi.runAllTimersAsync()
        expect(await pending).toBe('456')
        expect(clientFetch).toHaveBeenCalledTimes(2)
        expect(clientFetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([{ episodeId: '789' }, { episodeId: '789' }])
    })

    it('does not retry an insufficient-coins response', async () => {
        clientFetch.mockResolvedValue(Response.json({ success: false, error: '可用金币不足' }, { status: 402 }))
        await expect(startChapterJob('789')).rejects.toThrow('可用金币不足')
        expect(clientFetch).toHaveBeenCalledOnce()
    })

    it('rejects a completed job that has no saved chapter result', async () => {
        clientFetch.mockResolvedValue(response({ phase: 'done', result: { chapterContent: '' } }))
        await expect(pollChapterJob('456')).rejects.toThrow('未返回结果')
    })
})
