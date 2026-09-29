import { afterEach, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deleteLocalMediaWithinSubdirectory, localMediaFilePath, localMediaKey, localMediaResponse, readLocalMedia, saveLocalMediaFile } from './local-media'
import { inlineLocalMediaRequest, localFetch } from '@/lib/local-fetch'
let directory: string
const original = process.env.LOCAL_DATA_DIR
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-'))
    process.env.LOCAL_DATA_DIR = directory
})
afterEach(async () => {
    if (original === undefined) delete process.env.LOCAL_DATA_DIR
    else process.env.LOCAL_DATA_DIR = original
    await fs.rm(directory, { force: true, recursive: true })
})
it('serves saved files locally with ranges and HEAD, then deletes only owned files', async () => {
    const source = path.join(directory, 'source.mp4')
    await fs.writeFile(source, '0123456789')
    const url = await saveLocalMediaFile(source, 'videos', 'test.mp4')
    expect(url).toBe('/api/local-media/videos/test.mp4')
    expect((await readLocalMedia(url)).data.toString()).toBe('0123456789')
    expect(await localMediaFilePath(url)).toBe(path.join(directory, 'media/videos/test.mp4'))
    const range = await localFetch(url, { headers: { range: 'bytes=2-5' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await range.text()).toBe('2345')
    const suffix = await localMediaResponse(url, { headers: { range: 'bytes=-3' } })
    expect(await suffix.text()).toBe('789')
    const head = await localMediaResponse(url, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
    expect((await localMediaResponse(url, { headers: { range: 'bytes=12-20' } })).status).toBe(416)
    await expect(deleteLocalMediaWithinSubdirectory(url, 'other')).rejects.toThrow()
    await deleteLocalMediaWithinSubdirectory(url, 'videos')
    expect((await localMediaResponse(url)).status).toBe(404)
})
it('rejects traversal, external URL spoofing and symlinks', async () => {
    expect(localMediaKey('/api/local-media/%2e%2e%2fworkspace.json')).toBeNull()
    expect(localMediaKey('https://example.com/api/local-media/private.mp4')).toBeNull()
    await fs.mkdir(path.join(directory, 'media'))
    await fs.symlink(directory, path.join(directory, 'media', 'escape'))
    await expect(readLocalMedia('/api/local-media/escape/workspace.json')).rejects.toThrow('symlinks')
})
it('inlines only local media values into model JSON payloads', async () => {
    const source = path.join(directory, 'image.png')
    await fs.writeFile(source, 'image bytes')
    const url = await saveLocalMediaFile(source, 'images', 'ref.png')
    const converted = await inlineLocalMediaRequest({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: [{ image_url: { url } }], prompt: `describe ${url}` }) })
    expect(JSON.parse(String(converted.body))).toEqual({ content: [{ image_url: { url: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=' } }], prompt: `describe ${url}` })
})
it('gives regenerated images distinct immutable URLs', async () => {
    const { saveImmutableLocalImage } = await import('./local-media')
    const source = path.join(directory, 'source.png')
    await fs.writeFile(source, 'first')
    const first = await saveImmutableLocalImage(source, 'storyboards', 'frame.png')
    await fs.writeFile(source, 'second')
    const second = await saveImmutableLocalImage(source, 'storyboards', 'frame.png')
    expect(first).not.toBe(second)
    expect((await readLocalMedia(first)).data.toString()).toBe('first')
    expect((await readLocalMedia(second)).data.toString()).toBe('second')
})
