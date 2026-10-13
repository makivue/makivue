import { jsonrepair } from 'jsonrepair'
import { extractBalancedJsonObjects } from './json-response'

export type EpisodeScriptResponse = { title: string; synopsis: string; script: string }

export class ScriptResponseError extends Error {
    constructor() {
        super('拆剧本返回格式异常：未收到完整的 title、synopsis、script 字符串；本集未保存，请重新拆本集或继续拆剩余剧本')
        this.name = 'ScriptResponseError'
    }
}

/** The screenplay envelope is flat; only actual field boundaries close a value.
 * Dialogue may contain raw quotes and line breaks without becoming JSON syntax.
 */
function escapeScreenplayStrings(candidate: string): string {
    let offset = 1
    const fields: Record<string, string> = {}
    while (offset < candidate.length) {
        const field = candidate.slice(offset).match(/^\s*"(title|synopsis|script)"\s*:\s*"/)
        if (!field || Object.hasOwn(fields, field[1])) throw new ScriptResponseError()
        offset += field[0].length
        let encoded = '"'
        let closed = false
        for (; offset < candidate.length; offset++) {
            const character = candidate[offset]
            if (character === '\\') {
                encoded += candidate.slice(offset, offset + 2)
                offset++
            } else if (character === '"') {
                const tail = candidate.slice(offset + 1)
                if (/^\s*,\s*"(?:title|synopsis|script)"\s*:/.test(tail) || /^\s*,?\s*}\s*$/.test(tail)) {
                    fields[field[1]] = JSON.parse(encoded + '"') as string
                    offset++
                    closed = true
                    break
                }
                encoded += '\\"'
            } else {
                // JSON.stringify handles raw control characters without double
                // decoding intentional backslash escapes in model output.
                encoded += JSON.stringify(character).slice(1, -1)
            }
        }
        if (!closed) throw new ScriptResponseError()
        const tail = candidate.slice(offset)
        if (/^\s*,?\s*}\s*$/.test(tail)) return JSON.stringify(fields)
        const separator = tail.match(/^\s*,/)
        if (!separator) throw new ScriptResponseError()
        offset += separator[0].length
    }
    throw new ScriptResponseError()
}

/** Repair formatting only. Never let JSON repair manufacture a missing script tail. */
export function parseEpisodeScriptResponse(raw: string): EpisodeScriptResponse {
    const candidates = new Set([raw.trim(), ...extractBalancedJsonObjects(raw)])
    for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) candidates.add(match[1].trim())
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first >= 0 && last > first) candidates.add(raw.slice(first, last + 1).trim())

    for (const candidate of candidates) {
        let parsed: unknown
        try {
            parsed = JSON.parse(candidate)
        } catch {
            // All three fields are strings. A complete envelope must finish with
            // a quoted value and a closing brace, even when its formatting is bad.
            if (!/^\{/.test(candidate) || !/["']\s*,?\s*}$/.test(candidate)) continue
            try {
                parsed = JSON.parse(escapeScreenplayStrings(candidate))
            } catch {
                try {
                    parsed = JSON.parse(jsonrepair(candidate))
                } catch {
                    continue
                }
            }
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        const value = parsed as Record<string, unknown>
        if (['title', 'synopsis', 'script'].some(key => typeof value[key] !== 'string' || !(value[key] as string).trim())) continue
        return { title: (value.title as string).trim(), synopsis: (value.synopsis as string).trim(), script: (value.script as string).trim() }
    }
    throw new ScriptResponseError()
}
