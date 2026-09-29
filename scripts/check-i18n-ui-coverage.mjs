import fs from 'node:fs/promises'
import path from 'node:path'
import { extractMessages, walkTypeScript } from './i18n-source-messages.mjs'

const root = process.cwd()
const appRoot = path.join(root, 'src/app')
const files = await walkTypeScript(appRoot)
const failures = []

const switcher = await fs.readFile(path.join(root, 'src/components/LanguageSwitcher.tsx'), 'utf8')
if (/<select\b/i.test(switcher)) failures.push('LanguageSwitcher still uses a native select')
if (!switcher.includes('<fieldset') || !switcher.includes('<legend') || !switcher.includes('type="radio"') || !switcher.includes('name={name}')) {
    failures.push('LanguageSwitcher is missing its labeled native radio group')
}

const layout = await fs.readFile(path.join(root, 'src/app/layout.tsx'), 'utf8')
if (layout.includes('global-language-bar')) failures.push('root layout still renders a separate global language row')
if (layout.includes('<GlobalLanguageSwitcher') || layout.includes('<GlobalThemeSettings')) failures.push('root layout still renders separate floating settings')
for (const component of ['SiteHeader', 'CreationJourney']) {
    const header = await fs.readFile(path.join(root, `src/components/${component}.tsx`), 'utf8')
    if (!header.includes('<GlobalPreferences')) failures.push(`${component} is missing the shared language and appearance control`)
}
const preferences = await fs.readFile(path.join(root, 'src/components/GlobalPreferences.tsx'), 'utf8')
if (!preferences.includes('<LanguageSwitcher') || !preferences.includes('<GlobalThemeSettings')) failures.push('global preferences must group language and appearance settings')

// Project title and authored story content stay untouched, but taxonomy metadata
// and UI labels must be translated explicitly. These checks guard the sidebar
// regressions that DOM fallback cannot catch when data-i18n-skip is involved.
const projectPage = await fs.readFile(path.join(root, 'src/app/projects/[id]/page.tsx'), 'utf8')
if (!projectPage.includes('{t(project.genre)}')) failures.push('project genre taxonomy is not localized')
if (!projectPage.includes("{t('集')}")) failures.push('project episode count unit is not localized explicitly')
if (!projectPage.includes('{t(char.role)}') || !projectPage.includes('{t(char.gender)}')) failures.push('character taxonomy metadata is not localized explicitly')
if (!projectPage.includes("{t('年龄')}: {char.age}")) failures.push('character age is not rendered with a localized label')

const episodePage = await fs.readFile(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
if (!episodePage.includes('{t(project.genre)}')) failures.push('episode workspace genre taxonomy is not localized')
if (!episodePage.includes("{episodesCount} {t('集')}")) failures.push('episode workspace episode count unit is not localized explicitly')
for (const message of ['原声语言', '镜头预览', '成片']) {
    if (!episodePage.includes(`t('${message}')`)) failures.push(`episode workspace does not explicitly localize ${message}`)
}
for (const retiredAudioControl of ['SHOW_MANUAL_WAN_DRIVING_AUDIO', 'triggerBatchTts', "onGenerate('audio')"]) {
    if (episodePage.includes(retiredAudioControl)) failures.push(`retired manual audio control remains: ${retiredAudioControl}`)
}

// Check all application UI, including text hidden in menus, modals, titles and
// placeholders. Runtime translation supports composing longer UI messages from
// catalog fragments, so verify that no source-language fragment can survive.
const uiFiles = [
    ...files.filter(file => !file.includes('/api/') && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)),
    ...(await walkTypeScript(path.join(root, 'src/components'))).filter(file => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
]
const uiMessagesByFile = new Map()
for (const file of uiFiles) {
    const source = await fs.readFile(file, 'utf8')
    uiMessagesByFile.set(
        file,
        [...extractMessages(file, source)].filter(message => message.length > 1)
    )
}
for (const locale of ['en', 'fr', 'ar', 'id', 'hi', 'fil', 'ja', 'ko']) {
    const catalog = JSON.parse(await fs.readFile(path.join(root, `src/i18n/catalogs/${locale}.json`), 'utf8'))
    const keys = Object.keys(catalog)
        .filter(key => key.length > 1 && key.length <= 200 && /\p{Script=Han}/u.test(key))
        .sort((a, b) => b.length - a.length)
    for (const [file, messages] of uiMessagesByFile) {
        const uncovered = messages.filter(message => {
            let remainder = message
            for (const key of keys) remainder = remainder.replaceAll(key, '')
            return /\p{Script=Han}/u.test(remainder)
        })
        if (uncovered.length) failures.push(`${path.relative(root, file)} has ${uncovered.length} untranslated ${locale} messages: ${uncovered.slice(0, 5).join(' | ')}`)
    }
}

const episodeBatchModal = await fs.readFile(path.join(root, 'src/app/projects/[id]/episodes/[episodeId]/EpisodeBatchModal.tsx'), 'utf8')
for (const message of ['一键生成本集（插图 + 图生视频）', '进行中', '全部完成', '镜头', '后台运行']) {
    if (!episodeBatchModal.includes(`t('${message}')`)) failures.push(`episode batch modal does not explicitly localize ${message}`)
}

if (failures.length) {
    console.error(`i18n UI coverage check failed:\n${failures.join('\n')}`)
    process.exit(1)
}

console.log(`i18n UI coverage passed: global switcher and ${uiFiles.length} UI files checked`)
