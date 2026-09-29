import { localFetch } from '@/lib/local-fetch'
/**
 * 字幕生成服务
 *
 * 视频生成完成后调用，把分镜的中文台词（storyboard.dialogue）翻译成多语言，
 * 生成 SRT 字幕文件，并上传到 local storage。
 *
 * 支持语言：中文、英文、法文、印度语（印地语）、印尼语、阿拉伯语、日语、韩语、菲律宾语（他加禄语）
 */

import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import { randomUUID } from 'node:crypto'
import { chatJSON } from './llm'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { saveLocalMediaFile } from './local-media'
import { prisma } from '@/lib/prisma'
import { getConfiguredVideoLanguage, localizeVideoSpeech } from './video-language'

export type SubtitleLang = 'zh' | 'en' | 'fr' | 'hi' | 'id' | 'ar' | 'ja' | 'ko' | 'fil'

const SUBTITLE_LANGUAGES: Array<{ code: SubtitleLang; name: string; nativeName: string }> = [
    { code: 'zh', name: 'Chinese', nativeName: '中文' },
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
    { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'ko', name: 'Korean', nativeName: '한국어' },
    { code: 'fil', name: 'Filipino', nativeName: 'Filipino' }
]

/**
 * 将秒数格式化为 SRT 时间戳：HH:MM:SS,mmm
 */
function formatSrtTimestamp(seconds: number): string {
    const totalMs = Math.max(0, Math.round(seconds * 1000))
    const ms = totalMs % 1000
    const totalSec = Math.floor(totalMs / 1000)
    const s = totalSec % 60
    const m = Math.floor(totalSec / 60) % 60
    const h = Math.floor(totalSec / 3600)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

/** 从 dialogue 文本中抽取纯台词，并按行去掉「角色名：」前缀。 */
function extractDialogueText(dialogue: string): string {
    return dialogue
        .split(/\r?\n+/)
        .map(line => line.replace(/^\s*[^：:\n]{1,30}[：:]\s*/, '').trim())
        .filter(Boolean)
        .join('\n')
        .trim()
}

/**
 * 将长台词拆成适合播放器显示的字幕片段。
 * 之前一整个分镜只生成一条字幕，导致字幕长时间铺满画面；这里按
 * 句号/问号/换行切分，再按长度兜底切分，保证每条最多两行短句。
 */
function splitSubtitleSegments(text: string): string[] {
    const normalized = text
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim()
    if (!normalized) return []

    const sentenceParts = normalized
        .split(/(?<=[。！？!?；;])\s*|\n+/)
        .map(part => part.trim())
        .filter(Boolean)
    const segments: string[] = []
    const maxChars = 56

    for (const sentence of sentenceParts) {
        if (sentence.length <= maxChars) {
            segments.push(sentence)
            continue
        }

        let remaining = sentence
        while (remaining.length > maxChars) {
            // 英文优先在空格处分割，中文则按字符分割。
            const window = remaining.slice(0, maxChars + 1)
            const whitespace = window.lastIndexOf(' ')
            const cutAt = whitespace >= Math.floor(maxChars * 0.55) ? whitespace : maxChars
            segments.push(remaining.slice(0, cutAt).trim())
            remaining = remaining.slice(cutAt).trim()
        }
        if (remaining) segments.push(remaining)
    }
    return segments
}

function wrapSubtitleSegment(segment: string): string {
    const text = segment.trim()
    if (text.length <= 28) return text
    const whitespace = text.slice(0, 29).lastIndexOf(' ')
    const cutAt = whitespace >= 14 ? whitespace : 28
    return `${text.slice(0, cutAt).trim()}\n${text.slice(cutAt).trim()}`
}

function subtitleReadingWeight(text: string): number {
    // 中日韩字符按字计数，拉丁文本按词计数，作为没有逐字时间戳时的稳定兜底。
    const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length
    const latinWords = text
        .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    return Math.max(1, cjk + latinWords * 5)
}

/** 生成按句分段、按阅读量分配时间的 SRT。 */
function buildSrtContent(text: string, durationSec: number): string {
    const segments = splitSubtitleSegments(text)
    if (segments.length === 0) return ''

    const durationMs = Math.max(1000, Math.round(durationSec * 1000))
    // 极短镜头不能塞入过多 cue，否则会出现 0 秒字幕；必要时把尾部短句合并。
    const maxSegments = Math.max(1, Math.floor((durationMs + 120) / 620))
    const timedSegments = segments.length > maxSegments ? [...segments.slice(0, maxSegments - 1), segments.slice(maxSegments - 1).join(' ')] : segments
    const gapMs = timedSegments.length > 1 ? Math.min(120, Math.floor(durationMs / (timedSegments.length * 4))) : 0
    const availableMs = durationMs - gapMs * (timedSegments.length - 1)
    const totalWeight = timedSegments.reduce((sum, segment) => sum + subtitleReadingWeight(segment), 0)
    let cursorMs = 0

    return timedSegments
        .map((segment, index) => {
            const isLast = index === timedSegments.length - 1
            const rawDuration = isLast ? durationMs - cursorMs : Math.max(500, Math.round((availableMs * subtitleReadingWeight(segment)) / totalWeight))
            const startMs = cursorMs
            const endMs = Math.min(durationMs, startMs + Math.max(500, rawDuration))
            cursorMs = Math.min(durationMs, endMs + gapMs)
            return `${index + 1}\n${formatSrtTimestamp(startMs / 1000)} --> ${formatSrtTimestamp(endMs / 1000)}\n${wrapSubtitleSegment(segment)}\n`
        })
        .join('\n')
}

/**
 * 用 LLM 把视频实际原声翻译成目标语言。
 * 一次翻译多个语言，节省 token。
 */
async function translateDialogue(sourceText: string, sourceLanguage: 'zh' | 'en'): Promise<Record<SubtitleLang, string>> {
    const targetLangs = SUBTITLE_LANGUAGES.filter(l => l.code !== sourceLanguage)
    const langList = targetLangs.map(l => `- ${l.code} (${l.name} / ${l.nativeName})`).join('\n')
    const sourceName = sourceLanguage === 'en' ? 'English' : 'Chinese'

    const prompt = `You are a professional drama subtitle translator. Translate the ${sourceName} dialogue below into the following languages, keeping the emotional tone, natural spoken style, and appropriate cultural expression for each language.

Target languages:
${langList}

Rules:
- Preserve the emotional and dramatic tone
- Use natural, colloquial expression appropriate for TV/film subtitles
- Keep it concise; do not add explanations
- Do NOT add speaker names or brackets
- If the source is a question, keep it as a question
- Return ONLY a JSON object with the language codes as keys

${sourceName} dialogue:
"""
${sourceText}
"""

Return a JSON object containing exactly these target language codes: ${targetLangs.map(lang => lang.code).join(', ')}`

    try {
        const result = await chatJSON<Record<SubtitleLang, string>>([{ role: 'user', content: prompt }], { temperature: 0.3 })
        return {
            zh: sourceLanguage === 'zh' ? sourceText : (result.zh ?? ''),
            en: sourceLanguage === 'en' ? sourceText : (result.en ?? ''),
            fr: result.fr ?? '',
            hi: result.hi ?? '',
            id: result.id ?? '',
            ar: result.ar ?? '',
            ja: result.ja ?? '',
            ko: result.ko ?? '',
            fil: result.fil ?? ''
        }
    } catch (err) {
        console.error('[subtitle] translation failed:', err instanceof Error ? err.message : err)
        return {
            zh: sourceLanguage === 'zh' ? sourceText : '',
            en: sourceLanguage === 'en' ? sourceText : '',
            fr: '',
            hi: '',
            id: '',
            ar: '',
            ja: '',
            ko: '',
            fil: ''
        }
    }
}

/**
 * 为分镜的视频生成多语言字幕文件并上传 local storage。
 * 结果保存在 storyboard.subtitles 字段（JSON 字符串），格式为 { [lang]: mediaUrl }。
 *
 * 失败不影响主流程（视频合成不依赖字幕）。
 */
export async function generateStoryboardSubtitles(storyboardId: bigint): Promise<Record<SubtitleLang, string> | null> {
    try {
        const storyboard = await prisma.storyboard.findFirst({
            where: { id: storyboardId, deletedAt: null },
            select: { id: true, dialogue: true, duration: true, episodeId: true, operationVersion: true, episode: { select: { project: { select: { userId: true } } } } }
        })
        if (!storyboard || !storyboard.dialogue) {
            console.log(`[subtitle] storyboard ${storyboardId} has no dialogue, skip`)
            return null
        }

        const sourceText = extractDialogueText(storyboard.dialogue)
        if (!sourceText) return null

        const durationSec = storyboard.duration ?? 5
        const videoLanguage = await getConfiguredVideoLanguage()
        const translations = await withHiModelsUsageScope({ userId: storyboard.episode.project.userId }, async () => {
            const spokenText = await localizeVideoSpeech(sourceText, videoLanguage)
            return translateDialogue(spokenText, videoLanguage)
        })

        const tmpDir = path.join(process.cwd(), 'public', 'storage')
        if (!fsSync.existsSync(tmpDir)) await fs.mkdir(tmpDir, { recursive: true })

        const mediaUrls: Partial<Record<SubtitleLang, string>> = {}
        const subdir = `subtitles/${storyboard.episodeId}`
        const revision = randomUUID()

        for (const lang of SUBTITLE_LANGUAGES) {
            const text = translations[lang.code]
            if (!text) continue

            const srtContent = buildSrtContent(text, durationSec)
            const filename = `sb_${storyboardId}_${revision}_${lang.code}.srt`
            const absPath = path.join(tmpDir, filename)

            try {
                await fs.writeFile(absPath, srtContent, 'utf-8')
                const mediaUrl = await saveLocalMediaFile(absPath, subdir, filename)
                mediaUrls[lang.code] = mediaUrl
                // 上传成功后清理本地文件
                await fs.unlink(absPath).catch(() => {})
            } catch (err) {
                console.warn(`[subtitle] ${lang.code} upload failed for storyboard ${storyboardId}:`, err instanceof Error ? err.message : err)
            }
        }

        // 保存到数据库
        try {
            const saved = await prisma.storyboard.updateMany({
                where: { id: storyboardId, deletedAt: null, operationVersion: storyboard.operationVersion },
                data: { subtitles: JSON.stringify(mediaUrls) }
            })
            if (saved.count !== 1) return null
        } catch (err) {
            // 如果字段还没迁移，静默失败
            console.warn(`[subtitle] failed to save subtitles field:`, err instanceof Error ? err.message : err)
        }

        return mediaUrls as Record<SubtitleLang, string>
    } catch (err) {
        console.error(`[subtitle] generation failed for storyboard ${storyboardId}:`, err instanceof Error ? err.message : err)
        return null
    }
}

interface SubtitleCue {
    startMs: number
    endMs: number
    text: string
}

export function offsetAndClipSubtitleCues(cues: SubtitleCue[], offsetMs: number, segmentDurationMs: number, episodeDurationMs = Number.POSITIVE_INFINITY): SubtitleCue[] {
    const segmentEndMs = Math.min(offsetMs + segmentDurationMs, episodeDurationMs)
    if (segmentEndMs <= offsetMs) return []
    return cues
        .filter(cue => cue.startMs < segmentDurationMs)
        .map(cue => ({
            ...cue,
            startMs: Math.min(segmentEndMs - 1, offsetMs + Math.min(segmentDurationMs - 1, cue.startMs)),
            endMs: Math.min(segmentEndMs, offsetMs + Math.min(segmentDurationMs, Math.max(cue.startMs + 1, cue.endMs)))
        }))
        .filter(cue => cue.endMs > cue.startMs)
}

function parseSrtTimestamp(value: string): number {
    const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})$/)
    if (!match) return 0
    return (Number(match[1]) * 60 * 60 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4])
}

function formatSrtMs(ms: number): string {
    const safe = Math.max(0, Math.round(ms))
    const hours = Math.floor(safe / 3_600_000)
    const minutes = Math.floor((safe % 3_600_000) / 60_000)
    const seconds = Math.floor((safe % 60_000) / 1000)
    const millis = safe % 1000
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function parseSrtContent(content: string): SubtitleCue[] {
    return content
        .replace(/^\uFEFF/, '')
        .split(/\r?\n\r?\n+/)
        .map(block => {
            const lines = block.split(/\r?\n/)
            const timeLineIndex = lines.findIndex(line => line.includes('-->'))
            if (timeLineIndex < 0) return null
            const [start, end] = lines[timeLineIndex].split('-->').map(value => value.trim())
            if (!start || !end) return null
            const text = lines
                .slice(timeLineIndex + 1)
                .join('\n')
                .trim()
            if (!text) return null
            return { startMs: parseSrtTimestamp(start), endMs: parseSrtTimestamp(end), text }
        })
        .filter((cue): cue is SubtitleCue => !!cue)
}

function buildMergedSrt(cues: SubtitleCue[]): string {
    return cues.map((cue, index) => `${index + 1}\n${formatSrtMs(cue.startMs)} --> ${formatSrtMs(cue.endMs)}\n${cue.text}\n`).join('\n')
}

/**
 * 合并一集的多语言字幕：每种语言输出一个完整 SRT 文件。
 * 所有语言都作为独立可切换字幕文件保留，视频本身不烧录字幕。
 */
export async function mergeEpisodeSubtitles(episodeId: bigint, actualSegmentDurations: number[] = [], actualEpisodeDuration?: number): Promise<Partial<Record<SubtitleLang, string>>> {
    const waitUntil = Date.now() + 60_000
    let storyboards: Array<{ id: bigint; duration: number | null; dialogue: string | null; subtitles: string | null }> = []
    do {
        storyboards = await prisma.storyboard.findMany({
            where: { episodeId, deletedAt: null },
            orderBy: { order: 'asc' },
            select: { id: true, duration: true, dialogue: true, subtitles: true }
        })
        const waitingForGenerated = storyboards.some(sb => sb.dialogue?.trim() && !sb.subtitles)
        if (!waitingForGenerated || Date.now() >= waitUntil) break
        await new Promise(resolve => setTimeout(resolve, 1500))
    } while (true)

    const cuesByLang: Partial<Record<SubtitleLang, SubtitleCue[]>> = {}
    const episodeDurationMs = actualEpisodeDuration && actualEpisodeDuration > 0 ? Math.round(actualEpisodeDuration * 1000) : Number.POSITIVE_INFINITY
    let offsetMs = 0
    for (const [storyboardIndex, storyboard] of storyboards.entries()) {
        const segmentDurationMs = Math.max(1000, Math.round((actualSegmentDurations[storyboardIndex] ?? storyboard.duration ?? 5) * 1000))
        let subtitleUrls: Partial<Record<SubtitleLang, string>> = {}
        try {
            subtitleUrls = storyboard.subtitles ? (JSON.parse(storyboard.subtitles) as Partial<Record<SubtitleLang, string>>) : {}
        } catch {
            subtitleUrls = {}
        }

        for (const lang of SUBTITLE_LANGUAGES) {
            const url = subtitleUrls[lang.code]
            if (!url) continue
            try {
                const response = await localFetch(url, { signal: AbortSignal.timeout(30_000) })
                if (!response.ok) continue
                const cues = parseSrtContent(await response.text())
                if (!cuesByLang[lang.code]) cuesByLang[lang.code] = []
                cuesByLang[lang.code]!.push(...offsetAndClipSubtitleCues(cues, offsetMs, segmentDurationMs, episodeDurationMs))
            } catch (err) {
                console.warn(`[subtitle] failed to fetch ${lang.code} subtitle for storyboard ${storyboard.id}:`, err instanceof Error ? err.message : err)
            }
        }
        offsetMs = Math.min(episodeDurationMs, offsetMs + segmentDurationMs)
    }

    const result: Partial<Record<SubtitleLang, string>> = {}
    const revision = randomUUID()
    const tmpDir = path.join(process.cwd(), 'public', 'storage')
    await fs.mkdir(tmpDir, { recursive: true })
    for (const lang of SUBTITLE_LANGUAGES) {
        const cues = cuesByLang[lang.code]
        if (!cues || cues.length === 0) continue
        const filename = `episode_${episodeId}_${revision}_${lang.code}.srt`
        const absPath = path.join(tmpDir, filename)
        try {
            await fs.writeFile(absPath, buildMergedSrt(cues), 'utf-8')
            result[lang.code] = await saveLocalMediaFile(absPath, `subtitles/episodes/${episodeId}`, filename)
        } finally {
            await fs.unlink(absPath).catch(() => {})
        }
    }
    return result
}

export { SUBTITLE_LANGUAGES }
