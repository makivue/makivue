import fs from 'node:fs/promises'
import path from 'node:path'
import { collectSourceMessages } from './i18n-source-messages.mjs'

const root = process.cwd()
const locales = ['en', 'zh', 'fr', 'ar', 'id', 'hi', 'fil', 'ja', 'ko']
const catalogs = {}
for (const locale of locales) {
    const file = path.join(root, `src/i18n/catalogs/${locale}.json`)
    catalogs[locale] = JSON.parse(await fs.readFile(file, 'utf8'))
}

const sourceKeys = Object.keys(catalogs.zh).sort()
const failures = []
const placeholders = value => [...String(value).matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}|%[sdif]/g)].map(match => match[0]).sort()

const currentPhrases = await collectSourceMessages(root)
const uncatalogued = [...currentPhrases].filter(phrase => !Object.hasOwn(catalogs.zh, phrase))
if (uncatalogued.length) failures.push(`source scan: ${uncatalogued.length} uncatalogued messages\n${uncatalogued.slice(0, 10).join('\n')}`)
const stale = sourceKeys.filter(phrase => !currentPhrases.has(phrase))
if (stale.length) failures.push(`source scan: ${stale.length} stale catalog messages\n${stale.slice(0, 10).join('\n')}`)
for (const locale of locales) {
    const keys = Object.keys(catalogs[locale]).sort()
    const missing = sourceKeys.filter(key => !Object.hasOwn(catalogs[locale], key))
    const extra = keys.filter(key => !Object.hasOwn(catalogs.zh, key))
    const empty = sourceKeys.filter(key => !String(catalogs[locale][key] ?? '').trim())
    const placeholderMismatch = sourceKeys.filter(key => placeholders(key).join('\0') !== placeholders(catalogs[locale][key]).join('\0'))
    if (missing.length || extra.length || empty.length) {
        failures.push(`${locale}: missing=${missing.length}, extra=${extra.length}, empty=${empty.length}`)
    }
    if (placeholderMismatch.length) failures.push(`${locale}: ${placeholderMismatch.length} translations changed placeholders\n${placeholderMismatch.slice(0, 5).join('\n')}`)
    if (locale !== 'zh' && locale !== 'ja') {
        const mixed = sourceKeys.filter(key => /\p{Script=Han}/u.test(String(catalogs[locale][key] ?? '')))
        if (mixed.length) failures.push(`${locale}: ${mixed.length} translations still contain Chinese text\n${mixed.slice(0, 5).join('\n')}`)
    }
}

if (catalogs.en['选择语言'] === '选择语言') failures.push('English catalog did not translate the language selector')
if (catalogs.ar['选择语言'] === '选择语言') failures.push('Arabic catalog did not translate the language selector')
for (const key of ['AI 短剧生成器', '输入创意、小说或剧本，逐步完成角色设计、分镜与视频制作，创作你的短剧和漫剧。', '开始创作']) {
    if (!Object.hasOwn(catalogs.zh, key)) failures.push(`critical UI message is missing: ${key}`)
}
for (const key of ['Project not found', 'Please Confirm', 'frame preview', 'OpenAI API key not configured. Set GPT5_API_KEY or OPENAI_API_KEY in the server environment.']) {
    if (!Object.hasOwn(catalogs.en, key)) failures.push(`visible English message is missing: ${key}`)
    for (const locale of locales.filter(item => item !== 'en')) {
        if (!catalogs[locale][key] || catalogs[locale][key] === key) failures.push(`${locale}: visible English message was not translated: ${key}`)
    }
}

if (failures.length) {
    console.error(`i18n catalog check failed:\n${failures.join('\n')}`)
    process.exit(1)
}
console.log(`i18n catalogs complete: ${sourceKeys.length} messages × ${locales.length} locales`)
