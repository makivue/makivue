type JsonRecord = Record<string, unknown>

export type VeoVideoResult =
    | { kind: 'uri'; uri: string }
    | { kind: 'inline'; bytesBase64: string; mimeType: string | null }

function isRecord(value: unknown): value is JsonRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null
}

/** Vertex/Himodels may return a URI or the complete MP4 as base64 bytes. */
export function extractVeoVideoResult(payload: unknown): VeoVideoResult | null {
    const visit = (value: unknown, depth: number): VeoVideoResult | null => {
        if (depth > 6) return null
        if (Array.isArray(value)) {
            for (const item of value) {
                const result = visit(item, depth + 1)
                if (result) return result
            }
            return null
        }
        if (!isRecord(value)) return null

        const uri = nonEmptyString(value.video_url, value.videoUrl, value.gcsUri, value.uri)
        if (uri) return { kind: 'uri', uri }
        const bytesBase64 = nonEmptyString(value.bytes, value.bytesBase64Encoded)
        if (bytesBase64) return { kind: 'inline', bytesBase64, mimeType: nonEmptyString(value.mimeType) }

        for (const key of ['response', 'content', 'output', 'data', 'result', 'videos', 'generatedSamples', 'video']) {
            const result = visit(value[key], depth + 1)
            if (result) return result
        }
        return null
    }
    return visit(payload, 0)
}

export function decodeVeoInlineVideo(result: Extract<VeoVideoResult, { kind: 'inline' }>) {
    const encoded = result.bytesBase64.replace(/^data:video\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '')
    if (!encoded) throw new Error('视频服务返回了空文件')
    const buffer = Buffer.from(encoded, 'base64')
    if (buffer.length < 1024) throw new Error('视频服务返回的文件不完整')
    return buffer
}
