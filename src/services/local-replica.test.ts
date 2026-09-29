import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runLocalReplica } from './local-replica'
import { localMediaFilePath, saveLocalMediaFile } from './local-media'
import { probeDuration } from './ffmpeg'
let directory: string | undefined
afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    if (directory) await fs.rm(directory, { recursive: true, force: true })
})
it('sends sampled frames directly to the configured model and clips video locally', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-replica-ffmpeg-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
    vi.stubEnv('OPENAI_API_KEY', 'fixture-key')
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:19999')
    const source = path.join(directory, 'source.mp4')
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=24:d=2', '-c:v', 'libx264', source])
    const url = await saveLocalMediaFile(source, 'replica', 'source.mp4')
    const transport = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Blue frame', script: 'A blue frame.', clips: [{ start: 0.25, end: 1.25 }] }) } }] }))
    const result = await runLocalReplica('101', { mode: 'clip', payload: { videoUrl: url, maxClipDuration: 1 } })
    expect(transport).toHaveBeenCalledOnce()
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:19999/v1/chat/completions')
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body))
    expect(body.messages[0].content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(8)
    expect(String(result.output?.videoUrl)).toBe('/api/local-media/replica/101/clip.mp4')
    expect(await probeDuration(await localMediaFilePath(String(result.output?.videoUrl)))).toBeGreaterThan(0.9)
}, 30_000)
