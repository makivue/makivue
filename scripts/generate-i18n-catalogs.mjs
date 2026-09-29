import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import { collectSourceMessages } from './i18n-source-messages.mjs'

const root = process.cwd()
const targets = { en: 'en', zh: 'zh-CN', fr: 'fr', ar: 'ar', id: 'id', hi: 'hi', fil: 'tl', ja: 'ja', ko: 'ko' }
const targetNames = { en: 'English', fr: 'French', ar: 'Arabic', id: 'Indonesian', hi: 'Hindi', fil: 'Filipino', ja: 'Japanese', ko: 'Korean' }

function readLocalTranslationModel() {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_TEXT_API_KEY ?? process.env.AZURE_API_KEY ?? process.env.GPT5_API_KEY
    if (typeof apiKey !== 'string' || !apiKey.trim()) return null
    const baseUrl = String(process.env.OPENAI_BASE_URL ?? process.env.AZURE_OPENAI_TEXT_ENDPOINT ?? 'https://fixture.openai.azure.com').replace(/\/$/, '')
    const model = String(process.env.OPENAI_MODEL ?? 'gpt-5.4-shortdrama')
    const url = baseUrl.includes('/responses') ? baseUrl : `${baseUrl}/openai/responses?api-version=2025-04-01-preview`
    return { apiKey: apiKey.trim(), model, url }
}

function chunkMessages(values, maxItems = 500, maxChars = 14_000) {
    const batches = []
    let batch = []
    let chars = 0
    for (const value of values) {
        if (batch.length > 0 && (batch.length >= maxItems || chars + value.length > maxChars)) {
            batches.push(batch)
            batch = []
            chars = 0
        }
        batch.push(value)
        chars += value.length
    }
    if (batch.length > 0) batches.push(batch)
    return batches
}

function responseText(data) {
    if (typeof data?.output_text === 'string' && data.output_text) return data.output_text
    for (const item of data?.output ?? []) {
        for (const content of item?.content ?? []) {
            if (content?.type === 'output_text' && typeof content.text === 'string') return content.text
        }
    }
    return ''
}

async function translateBatchWithLocalModel(values, locale, config, repairAttempt = 0) {
    const targetName = targetNames[locale]
    let lastError
    let translated
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(config.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                signal: AbortSignal.timeout(5 * 60_000),
                body: JSON.stringify({
                    model: config.model,
                    input: [
                        {
                            role: 'system',
                            content: `Translate software UI messages into natural ${targetName}. Return JSON only. Preserve model names, URLs, placeholders, identifiers, punctuation and numbers. Do not omit, merge or reorder entries. Every translation must be in ${targetName}; do not leave Chinese text${locale === 'ja' ? ' unless it is natural Japanese kanji' : ''}.${repairAttempt > 0 && locale !== 'ja' ? ' This is a repair pass: the previous translations incorrectly contained Han characters. Use transliteration or a natural translation so every result contains zero Han characters.' : ''}`
                        },
                        {
                            role: 'user',
                            content: JSON.stringify({
                                targetLanguage: targetName,
                                entries: values.map((source, index) => ({ index, source })),
                                outputShape: { translations: [{ index: 0, text: 'translated text' }] }
                            })
                        }
                    ],
                    max_output_tokens: 32_768,
                    text: { format: { type: 'json_object' } }
                })
            })
            if (!response.ok) throw new Error(`translation model ${response.status}: ${(await response.text()).slice(0, 300)}`)
            const raw = responseText(await response.json())
            const parsed = JSON.parse(raw)
            const rows = Array.isArray(parsed.translations) ? parsed.translations : []
            const byIndex = new Map(rows.map(row => [Number(row?.index), typeof row?.text === 'string' ? row.text.trim() : '']))
            translated = values.map((_, index) => byIndex.get(index) ?? '')
            if (translated.some(value => !value)) throw new Error(`translation model omitted ${translated.filter(value => !value).length} entries`)
            break
        } catch (error) {
            lastError = error
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2_000 * (attempt + 1)))
        }
    }
    if (!translated) throw lastError

    if (locale !== 'ja') {
        const invalidIndexes = translated.map((value, index) => (/\p{Script=Han}/u.test(value) ? index : -1)).filter(index => index >= 0)
        if (invalidIndexes.length > 0) {
            if (repairAttempt >= 2) {
                const examples = invalidIndexes
                    .slice(0, 5)
                    .map(index => `${values[index]} => ${translated[index]}`)
                    .join(' | ')
                throw new Error(`translation model left Chinese text in ${invalidIndexes.length} results: ${examples}`)
            }
            process.stdout.write(`${locale}: repairing ${invalidIndexes.length} translations containing Chinese text\n`)
            const repaired = await translateBatchWithLocalModel(
                invalidIndexes.map(index => values[index]),
                locale,
                config,
                repairAttempt + 1
            )
            invalidIndexes.forEach((index, repairIndex) => {
                translated[index] = repaired[repairIndex]
            })
        }
    }
    return translated
}

async function translateMissing(values, locale, target, localModel) {
    if (values.length === 0) return []
    if (locale === 'zh') return values
    if (!localModel) {
        throw new Error(`Cannot generate ${target} translations: configure GPT5_API_KEY, OPENAI_API_KEY, AZURE_OPENAI_TEXT_API_KEY, or AZURE_API_KEY`)
    }

    const batches = chunkMessages(values)
    const translated = []
    for (const [index, batch] of batches.entries()) {
        process.stdout.write(`${locale}: batch ${index + 1}/${batches.length} (${batch.length} messages)\n`)
        translated.push(...(await translateBatchWithLocalModel(batch, locale, localModel)))
    }
    return translated
}

const phrases = await collectSourceMessages(root)
const ordered = [...phrases].sort((a, b) => a.localeCompare(b, 'zh-CN'))
const localModel = readLocalTranslationModel()
await fs.mkdir(path.join(root, 'src/i18n/catalogs'), { recursive: true })

for (const [locale, target] of Object.entries(targets)) {
    const outputFile = path.join(root, `src/i18n/catalogs/${locale}.json`)
    let existing = {}
    try {
        existing = JSON.parse(await fs.readFile(outputFile, 'utf8'))
    } catch {}
    const missing = ordered.filter(phrase => typeof existing[phrase] !== 'string' || !existing[phrase])
    process.stdout.write(`${locale}: ${missing.length} missing of ${ordered.length}\n`)
    const generated = await translateMissing(missing, locale, target, localModel)
    for (const [index, phrase] of missing.entries()) existing[phrase] = generated[index]
    const catalog = Object.fromEntries(ordered.map(phrase => [phrase, existing[phrase]]))
    await fs.writeFile(outputFile, `${JSON.stringify(catalog, null, 2)}\n`)
}

process.stdout.write(`Generated ${ordered.length} phrases for ${Object.keys(targets).length} locales.\n`)
