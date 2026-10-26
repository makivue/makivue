import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeCreatorClips } from './creator-video-merge-media'
import { probeMediaStreams } from './ffmpeg'

async function makeVideo(destination: string, color: string, audio: boolean) {
    await promisify(execFile)(process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=0.5`, ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.5'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', ...(audio ? ['-c:a', 'aac', '-shortest'] : ['-an']), destination])
}

describe('creator FFmpeg merge', () => {
    it('merges clips with and without sound into a playable local video', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creator-merge-media-test-'))
        try {
            const first = path.join(directory, 'first.mp4')
            const second = path.join(directory, 'second.mp4')
            const output = path.join(directory, 'merged.mp4')
            await makeVideo(first, 'red', true)
            await makeVideo(second, 'blue', false)
            const progress: number[] = []
            const duration = await mergeCreatorClips([first, second], output, '9:16', async completed => { progress.push(completed) })
            const streams = await probeMediaStreams(output)
            expect(streams.hasVideo).toBe(true)
            expect(streams.hasAudio).toBe(true)
            expect(duration).toBeGreaterThan(0.9)
            expect(duration).toBeLessThan(1.3)
            expect(progress).toEqual([1, 2])
            expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['first.mp4', 'second.mp4', 'merged.mp4']))
            expect((await fs.readdir(directory)).some(file => file.endsWith('.txt') || /merged.mp4\.\d/.test(file))).toBe(false)
        } finally {
            await fs.rm(directory, { recursive: true, force: true })
        }
    }, 30_000)
})
