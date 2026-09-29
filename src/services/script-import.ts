/**
 * 剧本导入识别服务
 *
 * 用户粘贴的文本可能是以下几种形态之一：
 * 1. 大纲（只有分集概要）
 * 2. 正文（长篇小说正文）
 * 3. 剧本（已拆分为每集的剧本）
 * 4. 分镜（已拆分为每集每分镜的详细描述）
 *
 * 使用 LLM 识别输入内容的形态并结构化输出，供后续导入到项目。
 */

import { chatJSON } from './llm'
import { clampIntensity } from '@/lib/project-metadata'

type ScriptStage = 'outline' | 'novel' | 'script' | 'storyboard'

interface DetectedOutlineChapter {
    episodeNumber: number
    title?: string
    synopsis: string
    intensity?: number
}

export interface DetectedScriptEpisode {
    episodeNumber: number
    title?: string
    synopsis?: string
    chapterContent?: string
    script?: string
    storyboards?: DetectedStoryboard[]
}

interface DetectedStoryboard {
    order: number
    shotType?: string
    duration?: number
    dialogue?: string
    narration?: string
    actionDesc?: string
    imagePrompt?: string
}

export interface DetectedScriptResult {
    stage: ScriptStage
    projectTitle?: string
    projectDescription?: string
    genre?: string
    totalEpisodes?: number
    outline?: DetectedOutlineChapter[]
    episodes?: DetectedScriptEpisode[]
    /** 如果整体只是一部长篇正文（未拆集），保存在这里 */
    novel?: string
}

interface StructuredImportSection {
    episodeNumber: number
    title?: string
    unit: string
    content: string
}

const EPISODE_HEADING_RE = /^[ \t]*第\s*([0-9０-９一二三四五六七八九十百两〇零]+)\s*([集章回])(?:\s*[:：\-—]?\s*([^\r\n]*))?\s*$/gm
const SHOT_HEADING_RE = /^[ \t]*[●•·○]?\s*(?:画面|镜头|分镜)\s*([0-9０-９一二三四五六七八九十百两〇零]+)([^\r\n]*)$/gim
const SCENE_HEADING_RE = /^[ \t]*(?:场景\s*[0-9一二三四五六七八九十]+\s*[:：]?|\d+\s*[-－—]\s*\d+\s+[^\r\n]+)$/gim
const DIALOGUE_LINE_RE = /^[ \t]*([^：:\r\n]{1,20})[：:]\s*([^\r\n]+)$/gm

function structuredNumber(value: string, fallback: number): number {
    const normalized = value.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0))
    if (/^\d+$/.test(normalized)) return Math.max(1, Number(normalized))
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    let total = 0
    let current = 0
    for (const character of normalized) {
        if (character === '百') {
            total += (current || 1) * 100
            current = 0
        } else if (character === '十') {
            total += (current || 1) * 10
            current = 0
        } else if (character in digits) {
            current = digits[character]
        }
    }
    return Math.max(1, total + current || fallback)
}

function titleFromFilename(filename?: string): string | undefined {
    if (!filename?.trim()) return undefined
    const title = filename
        .replace(/^.*[\\/]/, '')
        .replace(/\.(?:txt|md|markdown|docx|pdf)$/i, '')
        .replace(/[\s_-]*(?:剧本|脚本|分镜稿?|大纲|小说|正文)$/i, '')
        .trim()
    return title && title.length <= 80 ? title : undefined
}

function splitStructuredSections(rawText: string): { prefix: string; sections: StructuredImportSection[] } {
    const matches = [...rawText.matchAll(new RegExp(EPISODE_HEADING_RE.source, EPISODE_HEADING_RE.flags))]
    if (!matches.length) return { prefix: '', sections: [] }
    const prefix = rawText.slice(0, matches[0].index).trim()
    const sections = matches.map((match, index) => {
        const start = (match.index ?? 0) + match[0].length
        const end = matches[index + 1]?.index ?? rawText.length
        return {
            episodeNumber: structuredNumber(match[1], index + 1),
            unit: match[2],
            title: match[3]?.trim() || undefined,
            content: rawText.slice(start, end).trim()
        }
    })
    return { prefix, sections }
}

function parseStoryboardBlocks(content: string): DetectedStoryboard[] {
    const matches = [...content.matchAll(new RegExp(SHOT_HEADING_RE.source, SHOT_HEADING_RE.flags))]
    return matches.map((match, index) => {
        const start = (match.index ?? 0) + match[0].length
        const end = matches[index + 1]?.index ?? content.length
        const headerDetail = match[2]?.replace(/^[\s:：\-—]+/, '').trim() ?? ''
        const body = content.slice(start, end).trim()
        const description = [headerDetail, body].filter(Boolean).join('\n').trim()
        const shotType = `${headerDetail} ${body.slice(0, 120)}`.match(/大远景|远景|全景|中景|近景|极特写|特写/)?.[0]
        const durationValue = description.match(/(?:时长|持续)?\s*(\d+(?:\.\d+)?)\s*秒/)?.[1]
        const duration = durationValue ? Math.min(30, Math.max(3, Math.round(Number(durationValue)))) : 5
        const dialogues: string[] = []
        const narrations: string[] = []
        for (const line of description.matchAll(new RegExp(DIALOGUE_LINE_RE.source, DIALOGUE_LINE_RE.flags))) {
            const speaker = line[1].trim()
            const spoken = line[2].trim()
            if (/^(?:旁白|字幕|画外音|OS|VO)$/i.test(speaker)) narrations.push(`${speaker}：${spoken}`)
            else if (!/^(?:画面|镜头|分镜|场景|时长|景别|地点)$/i.test(speaker)) dialogues.push(`${speaker}：${spoken}`)
        }
        return {
            order: index + 1,
            shotType,
            duration,
            dialogue: dialogues.join('\n') || undefined,
            narration: narrations.join('\n') || undefined,
            actionDesc: description || match[0].trim(),
            imagePrompt: description || match[0].trim()
        }
    })
}

/**
 * Parses importable text synchronously using explicit document structure.
 * This is the default import path: it performs no model call and therefore
 * handles normal screenplay documents in milliseconds instead of minutes.
 */
export function parseImportTextFast(rawText: string, filename?: string): DetectedScriptResult {
    const text = rawText.trim()
    if (text.length < 20) throw new Error('输入内容过短，无法识别')

    const { sections, prefix } = splitStructuredSections(text)
    const contents = sections.length ? sections.map(section => section.content) : [text]
    const shotCount = contents.reduce((total, content) => total + [...content.matchAll(new RegExp(SHOT_HEADING_RE.source, SHOT_HEADING_RE.flags))].length, 0)
    const sceneCount = [...text.matchAll(new RegExp(SCENE_HEADING_RE.source, SCENE_HEADING_RE.flags))].length
    const dialogueCount = [...text.matchAll(new RegExp(DIALOGUE_LINE_RE.source, DIALOGUE_LINE_RE.flags))].filter(match => !/^(?:字幕|旁白|画外音|时长|景别|地点)$/i.test(match[1].trim())).length
    const projectTitle = titleFromFilename(filename) ?? (prefix && !prefix.includes('\n') && prefix.length <= 80 ? prefix : undefined)
    const maxEpisodeNumber = sections.length ? Math.max(...sections.map(section => section.episodeNumber)) : 1

    if (shotCount > 0) {
        const sourceSections = sections.length ? sections : [{ episodeNumber: 1, unit: '集', content: text, title: undefined }]
        return normaliseResult({
            stage: 'storyboard',
            projectTitle,
            totalEpisodes: maxEpisodeNumber,
            episodes: sourceSections.map(section => ({
                episodeNumber: section.episodeNumber,
                title: section.title,
                script: section.content,
                storyboards: parseStoryboardBlocks(section.content)
            }))
        })
    }

    if (sceneCount > 0 || dialogueCount >= 2) {
        const sourceSections = sections.length ? sections : [{ episodeNumber: 1, unit: '集', content: text, title: undefined }]
        return normaliseResult({
            stage: 'script',
            projectTitle,
            totalEpisodes: maxEpisodeNumber,
            episodes: sourceSections.map(section => ({
                episodeNumber: section.episodeNumber,
                title: section.title,
                script: section.content
            }))
        })
    }

    const isChapteredNovel = sections.some(section => section.unit === '章' || section.unit === '回')
    const averageSectionLength = sections.length ? sections.reduce((total, section) => total + section.content.length, 0) / sections.length : text.length
    if (isChapteredNovel || averageSectionLength > 1_500) {
        return normaliseResult({
            stage: 'novel',
            projectTitle,
            totalEpisodes: maxEpisodeNumber,
            episodes: sections.map(section => ({
                episodeNumber: section.episodeNumber,
                title: section.title,
                chapterContent: section.content
            })),
            novel: sections.length ? undefined : text
        })
    }

    const outlineSections = sections.length ? sections : [{ episodeNumber: 1, unit: '集', content: text, title: undefined }]
    return normaliseResult({
        stage: 'outline',
        projectTitle,
        totalEpisodes: maxEpisodeNumber,
        outline: outlineSections.map(section => ({
            episodeNumber: section.episodeNumber,
            title: section.title,
            synopsis: section.content
        }))
    })
}

/**
 * 快速启发式判断输入形态。用于确定 LLM 提示词的重点。
 * 结果只是提示，最终以 LLM 输出为准。
 */
function heuristicStageHint(text: string): ScriptStage {
    const t = text.slice(0, 3000)
    // 分镜关键词
    if (/镜头\s*[\d一二三四五六七八九十]+\s*[：:]|shot\s*\d+|SCENE\s*\d+|分镜\s*[\d一二三四五六七八九十]+/i.test(t)) {
        return 'storyboard'
    }
    // 剧本关键词：角色对话行为多，"角色名：台词" 常见
    const dialogueLines = (t.match(/^[^：:\n]{1,10}[：:]\s*[^\n]+/gm) ?? []).length
    if (dialogueLines >= 8) return 'script'
    // 分集关键词：多集大纲
    if (/第\s*[一二三四五六七八九十百\d]+\s*[集章回]/g.test(t) && (t.match(/第\s*[一二三四五六七八九十百\d]+\s*[集章回]/g)?.length ?? 0) >= 3) {
        // 判断内容长度：短就是大纲，长就是正文
        return text.length < 4000 ? 'outline' : 'novel'
    }
    return text.length < 2000 ? 'outline' : 'novel'
}

/**
 * 让 LLM 识别输入文本的形态和结构。
 */
export async function detectAndParseScriptChunk(rawText: string, chunkIndex: number, chunkCount: number): Promise<DetectedScriptResult> {
    if (!rawText || rawText.trim().length < 20) {
        throw new Error('输入内容过短，无法识别')
    }

    const hint = heuristicStageHint(rawText)

    const prompt = `你是一名资深的短剧项目导入助手。分析下面用户提供的文本，判断它属于哪个阶段并结构化输出。

当前输入是完整导入文本的第 ${chunkIndex + 1}/${chunkCount} 块。只分析这一块实际出现的内容；保留明确的原始集号，不要自行补造其它块的章节。

## 四种可能的阶段

- **outline**: 只有分集概要（每集一小段简介），没有完整正文
- **novel**: 长篇正文小说（未按集拆分，或按集但每集有完整文字正文）
- **script**: 每集有独立的短剧剧本（角色对话、场景切换、动作描述明显）
- **storyboard**: 已经按分镜拆分（每个镜头单独描述景别/时长/画面/台词）

## 启发式提示：预判为 **${hint}**（仅供参考，请自行判断）

## 输出规则

严格按以下 JSON 结构返回，不要输出任何其他文本：

\`\`\`json
{
  "stage": "outline" | "novel" | "script" | "storyboard",
  "projectTitle": "从内容中提取或推断的剧名（可选）",
  "projectDescription": "剧情简介（可选，1-3 句）",
  "genre": "题材类型（可选，如：都市言情、古装仙侠、悬疑推理等）",
  "totalEpisodes": 分集总数（数字），
  "outline": [  // 仅 stage=outline 或以上包含大纲信息时
    { "episodeNumber": 1, "title": "第1集标题", "synopsis": "本集剧情简介", "intensity": 3 }
  ],
  "episodes": [  // 仅 stage=novel/script/storyboard 时
    {
      "episodeNumber": 1,
      "title": "第1集",
      "synopsis": "本集简介",
      "chapterContent": "本集正文小说文字（仅 novel）",
      "script": "本集短剧剧本（仅 script/storyboard）",
      "storyboards": [  // 仅 stage=storyboard 时
        {
          "order": 1,
          "shotType": "特写|近景|中景|全景|远景",
          "duration": 5,
          "dialogue": "角色名：台词",
          "narration": "旁白",
          "actionDesc": "画面动作描述",
          "imagePrompt": "画面描述"
        }
      ]
    }
  ],
  "novel": "如果只是整体长篇未拆分正文，放这里"
}
\`\`\`

## 要求

- 尽量抽取 projectTitle、genre、剧情简介
- 优先按用户明确的分集编号（第X集/第X章/第X回）保留
- 如果内容不足以填充某些字段，字段可省略或为空数组
- storyboards 的 duration 单位是秒（默认 5，取值 3-15）
- intensity 是情感强度 1-10

## 输入文本

\`\`\`
${rawText}
\`\`\``

    const result = await chatJSON<DetectedScriptResult>([{ role: 'user', content: prompt }], {
        temperature: 0.2,
        maxTokens: 32000,
        // A durable worker retries from the last completed chunk. Keeping a
        // single provider attempt bounded avoids one request occupying a
        // lease for ten minutes before the worker can recover it.
        timeoutMs: 4 * 60 * 1000,
        attempts: 1
    })
    return normaliseResult(result)
}

const IMPORT_ANALYSIS_CHUNK_CHARS = 48_000

export function splitImportText(rawText: string, maxChars = IMPORT_ANALYSIS_CHUNK_CHARS): string[] {
    const text = rawText.trim()
    if (text.length <= maxChars) return [text]
    const chunks: string[] = []
    let cursor = 0
    while (cursor < text.length) {
        let end = Math.min(text.length, cursor + maxChars)
        if (end < text.length) {
            const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('\n', end), text.lastIndexOf('。', end))
            if (boundary > cursor + Math.floor(maxChars * 0.65)) end = boundary + 1
        }
        chunks.push(text.slice(cursor, end).trim())
        cursor = end
    }
    return chunks.filter(Boolean)
}

function appendDistinct(left: string | undefined, right: string | undefined): string | undefined {
    const a = left?.trim()
    const b = right?.trim()
    if (!a) return b
    if (!b || a.includes(b)) return a
    if (b.includes(a)) return b
    return `${a}\n\n${b}`
}

export function mergeDetectedScriptChunks(results: DetectedScriptResult[], rawText: string): DetectedScriptResult {
    const stageRank: Record<ScriptStage, number> = { outline: 0, novel: 1, script: 2, storyboard: 3 }
    const stage = results.reduce<ScriptStage>((best, result) => (stageRank[result.stage] > stageRank[best] ? result.stage : best), 'outline')
    const episodeByNumber = new Map<number, DetectedScriptEpisode>()
    const outlineByNumber = new Map<number, DetectedOutlineChapter>()

    for (const result of results) {
        for (const episode of result.episodes ?? []) {
            const existing = episodeByNumber.get(episode.episodeNumber)
            if (!existing) {
                episodeByNumber.set(episode.episodeNumber, { ...episode, storyboards: [...(episode.storyboards ?? [])] })
                continue
            }
            const storyboards = [...(existing.storyboards ?? []), ...(episode.storyboards ?? [])].map((storyboard, index) => ({ ...storyboard, order: index + 1 }))
            episodeByNumber.set(episode.episodeNumber, {
                ...existing,
                title: existing.title || episode.title,
                synopsis: appendDistinct(existing.synopsis, episode.synopsis),
                chapterContent: appendDistinct(existing.chapterContent, episode.chapterContent),
                script: appendDistinct(existing.script, episode.script),
                storyboards
            })
        }
        for (const chapter of result.outline ?? []) {
            const existing = outlineByNumber.get(chapter.episodeNumber)
            if (!existing || (chapter.synopsis?.length ?? 0) > (existing.synopsis?.length ?? 0)) outlineByNumber.set(chapter.episodeNumber, chapter)
        }
    }

    const episodes = [...episodeByNumber.values()].sort((a, b) => a.episodeNumber - b.episodeNumber)
    const outline = [...outlineByNumber.values()].sort((a, b) => a.episodeNumber - b.episodeNumber)
    const novel =
        stage === 'novel' && episodes.every(episode => !episode.chapterContent?.trim())
            ? rawText.trim()
            : results
                  .map(result => result.novel?.trim())
                  .filter(Boolean)
                  .join('\n\n') || undefined
    return normaliseResult({
        stage,
        projectTitle: results.find(result => result.projectTitle?.trim())?.projectTitle,
        projectDescription: results.find(result => result.projectDescription?.trim())?.projectDescription,
        genre: results.find(result => result.genre?.trim())?.genre,
        totalEpisodes: Math.max(...results.map(result => result.totalEpisodes ?? 0), episodes.length, outline.length, 1),
        outline,
        episodes,
        novel
    })
}

function normaliseResult(r: DetectedScriptResult): DetectedScriptResult {
    const stage = ['outline', 'novel', 'script', 'storyboard'].includes(r.stage) ? r.stage : 'outline'
    const episodes = (r.episodes ?? []).map((e, i) => ({
        ...e,
        episodeNumber: Number(e.episodeNumber) || i + 1,
        storyboards: (e.storyboards ?? []).map((sb, j) => ({
            ...sb,
            order: Number(sb.order) || j + 1,
            duration: sb.duration ? Math.min(30, Math.max(3, Math.round(Number(sb.duration)))) : 5
        }))
    }))
    const outline = (r.outline ?? []).map((c, i) => ({
        ...c,
        episodeNumber: Number(c.episodeNumber) || i + 1,
        intensity: clampIntensity(c.intensity) ?? undefined
    }))
    const totalEpisodes = r.totalEpisodes ?? Math.max(episodes.length, outline.length, 1)
    return { ...r, stage, episodes, outline, totalEpisodes }
}
