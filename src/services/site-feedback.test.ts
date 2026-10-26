import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/feedback/route'
import { POST as upload } from '@/app/api/feedback/upload/route'
import { readFeedbackReceipt } from './site-feedback-upload'

let directory: string
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'makivue-feedback-test-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected remote call'))
})
afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
})
it('saves verified attachments and feedback locally and serializes concurrent quota checks', async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer()
    const form = new FormData()
    form.append('file', new File([new Uint8Array(image)], 'screen.png', { type: 'image/png' }))
    const response = await upload(new Request('http://localhost/api/feedback/upload', { method: 'POST', body: form }))
    expect(response.status).toBe(201)
    const { data } = await response.json()
    expect(data.attachment.url).toMatch(/^\/api\/local-media\/feedback\/1\//)
    await expect(readFeedbackReceipt(data.receipt, 2n)).rejects.toThrow('附件凭证无效')
    await expect(readFeedbackReceipt('forged', 1n)).rejects.toThrow('附件凭证无效')
    const request = () => new Request('http://localhost/api/feedback', { method: 'POST', body: JSON.stringify({ content: 'Layout issue', pageName: '/projects?token=private', receipts: [data.receipt] }) })
    const results = await Promise.all([POST(request()), POST(request())])
    expect(results.map(result => result.status).sort()).toEqual([201, 429])
    expect(await prisma.siteFeedback.count()).toBe(1)
    const saved = await prisma.siteFeedback.findFirstOrThrow()
    expect(saved.pageName).toBe('/projects')
    expect(saved.attachments).toEqual([data.attachment])
    expect((await (await GET(new Request('http://localhost/api/feedback'))).json()).data.allowed).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
})
it('rejects disguised images and invalid content without consuming allowance', async () => {
    const form = new FormData()
    form.append('file', new File(['not an image'], 'image.png', { type: 'image/png' }))
    expect((await upload(new Request('http://localhost/api/feedback/upload', { method: 'POST', body: form }))).status).toBe(400)
    expect((await POST(new Request('http://localhost/api/feedback', { method: 'POST', body: JSON.stringify({ content: '' }) }))).status).toBe(400)
    expect(await prisma.siteFeedback.count()).toBe(0)
    expect((await (await GET(new Request('http://localhost/api/feedback'))).json()).data.allowed).toBe(true)
})
