import { describe, expect, it } from 'vitest'
import { DRAMA_PART_BYTES, validateDramaFile, validateDramaSubtitle } from './drama-upload'

const encode = (value: string) => new TextEncoder().encode(value)

describe('drama upload validation', () => {
    it('allows episode-sized videos and enforces separate media limits', () => {
        expect(validateDramaFile('video', { name: 'episode.MP4', size: 2 * 1024 ** 3 })).toBeNull()
        expect(validateDramaFile('video', { name: 'episode.mp4', size: 2 * 1024 ** 3 + 1 })).toBeTruthy()
        expect(validateDramaFile('subtitle', { name: 'captions.srt', size: DRAMA_PART_BYTES + 1 })).toBeTruthy()
        expect(validateDramaFile('cover', { name: 'cover.svg', size: 50 })).toBeTruthy()
        expect(validateDramaFile('portrait', { name: 'person.jpeg', size: 50 })).toBeNull()
        expect(validateDramaFile('subtitle', { name: 'captions.exe', size: 50 })).toBeTruthy()
    })

    it('accepts SRT with BOM, CRLF and multiple cues and WebVTT with cue identifiers and settings', () => {
        expect(validateDramaSubtitle('captions.srt', encode('\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld'))).toBeNull()
        expect(validateDramaSubtitle('captions.vtt', encode('WEBVTT\n\nNOTE some metadata\n\nfirst\n00:01.000 --> 00:02.000 align:start\nHello'))).toBeNull()
    })

    it.each([
        ['srt', 'plain text renamed as subtitles'],
        ['srt', '1\n00:00:01,000 --> 00:00:01,000\nNo duration'],
        ['srt', '1\n00:00:02,000 --> 00:00:01,000\nBackwards'],
        ['srt', '1\n00:99:01,000 --> 00:99:02,000\nInvalid minutes'],
        ['srt', '1\n00:00:01,000 --> 00:00:02,000\n'],
        ['srt', '1\n00:00:01,000 --> 00:00:02,000\nValid\n\n2\nmalformed cue\nInvalid'],
        ['vtt', '00:01.000 --> 00:02.000\nMissing WEBVTT header'],
        ['vtt', 'WEBVTT\n\nNOTE only comments']
    ])('rejects malformed %s subtitles', (extension, text) => {
        expect(validateDramaSubtitle(`captions.${extension}`, encode(text))).toBeTruthy()
    })

    it('rejects malformed UTF-8 instead of silently replacing characters', () => {
        expect(validateDramaSubtitle('captions.srt', new Uint8Array([0xff, 0xfe, 0x31]))).toBeTruthy()
    })
})
