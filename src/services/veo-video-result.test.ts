import { describe, expect, it } from 'vitest'
import { decodeVeoInlineVideo, extractVeoVideoResult } from './veo-video-result'

describe('Veo video result extraction', () => {
    it('reads the legacy GCS result', () => {
        expect(extractVeoVideoResult({ response: { videos: [{ gcsUri: 'gs://bucket/video.mp4' }] } })).toEqual({
            kind: 'uri',
            uri: 'gs://bucket/video.mp4'
        })
    })

    it('reads the Himodels video URL', () => {
        expect(extractVeoVideoResult({ response: { videos: [{ video_url: 'https://cdn.example/video.mp4' }] } })).toEqual({
            kind: 'uri',
            uri: 'https://cdn.example/video.mp4'
        })
    })

    it('reads inline bytes returned by GenerateVideoResponse', () => {
        const bytesBase64 = Buffer.alloc(2048, 7).toString('base64')
        const result = extractVeoVideoResult({
            response: {
                '@type': 'type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse',
                videos: [{ bytes: bytesBase64, mimeType: 'video/mp4' }]
            }
        })

        expect(result).toEqual({ kind: 'inline', bytesBase64, mimeType: 'video/mp4' })
        expect(result?.kind === 'inline' ? decodeVeoInlineVideo(result).length : 0).toBe(2048)
    })

    it('reads generatedSamples inline bytes variants', () => {
        const bytesBase64 = Buffer.alloc(1536, 3).toString('base64')
        expect(
            extractVeoVideoResult({
                response: { generatedSamples: [{ video: { bytesBase64Encoded: bytesBase64 } }] }
            })
        ).toEqual({ kind: 'inline', bytesBase64, mimeType: null })
    })

    it('rejects missing or truncated inline files', () => {
        expect(extractVeoVideoResult({ done: true, response: { videos: [{}] } })).toBeNull()
        expect(() => decodeVeoInlineVideo({ kind: 'inline', bytesBase64: Buffer.from('short').toString('base64'), mimeType: null })).toThrow('文件不完整')
    })
})
