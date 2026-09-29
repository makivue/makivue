import { describe, expect, it } from 'vitest'
import { translateMessage } from './catalog'
import { localeDisplayName, locales, localizePath, localeFromPathname, resolveRequestLocale, storedLocaleForUnlocalizedPath, stripLocale } from './config'
import { SEO_FEATURE_LOCALE } from './seo'
import { seoPageSlugs } from '@/lib/seo-pages'
import { PROJECT_GENRES } from '@/lib/project-genres'
import { legalPageCopy } from './legal-ui'

describe('UI translation safety', () => {
    it.each(locales)('translates dynamic labels before inserting values in %s', locale => {
        for (const source of [
            '{seconds} 秒',
            '从 {completed}/{total} 继续提取',
            '第{number}章标题',
            '{count} 字',
            '第{number}章',
            '请先生成第 {number} 章',
            '第{number}集',
            '有 {count} 个分镜需要先拆分',
            '自动拆成 {count} 镜',
            '有 {count} 个已选角色缺少视觉描述',
            '有 {count} 个已选场景缺少视觉描述',
            '大纲已生成 {count} 章',
            '正在补充剩余大纲 {completed}/{total} 章',
            '剩余大纲已补充完成，共生成 {count} 章',
            '第{number}章已生成',
            '批量生成完成，共 {count} 章',
            '第{number}集剧本已生成',
            '拆剧本完成，共 {count} 集',
            '警告',
            '提示',
            '{completed}/{total} 次',
            '本任务已排队：单作品最多同时 {projectMax} 个{task}任务，当前账号总计最多 {userMax} 个；有空闲名额后会自动开始。',
            '分镜生成完成，共 {count} 集',
            '单条 {min}–{max} 秒',
            '合计不超过 {seconds} 秒',
            '当前还能上传 {remaining} 个参考视频，每个分镜最多 {limit} 个',
            '第 {attempt}/{maxAttempts} 轮',
            '多视图角色设定板生成完成：{count} 张'
        ]) {
            const values = {
                seconds: 7.5,
                completed: 3,
                total: 12,
                number: 7,
                count: 0,
                projectMax: 20,
                userMax: 30,
                task: translateMessage(locale, '视频'),
                min: 2,
                max: 15,
                remaining: 1,
                limit: 3,
                attempt: 2,
                maxAttempts: 5
            }
            const result = translateMessage(locale, source, values)
            expect(result).not.toMatch(/\{\w+\}/)
            for (const [name, value] of Object.entries(values)) {
                if (source.includes(`{${name}}`)) expect(result, source).toContain(String(value))
            }
            if (locale !== 'zh' && locale !== 'ja') expect(result, source).not.toMatch(/\p{Script=Han}/u)
        }
        expect(translateMessage(locale, '第{number}集', { number: '开始创作' })).toContain('开始创作')
    })

    it('preserves missing placeholders and does not read inherited values', () => {
        expect(translateMessage('en', '从 {completed}/{total} 继续提取', { completed: 0 })).toBe('Continue extraction from 0/{total}')
        expect(translateMessage('en', '{number}', Object.create({ number: 7 }))).toBe('{number}')
        expect(translateMessage('en', '第{number}集', { number: '{count}' })).toBe('Episode {count}')
    })

    it('localizes previously uncovered English UI labels', () => {
        expect(translateMessage('zh', 'Generation capacity')).toBe('生成并发额度')
        expect(translateMessage('fil', 'AI Video Replica')).not.toBe('AI Video Replica')
    })

    it.each(locales.filter(locale => locale !== 'zh'))('localizes every legal-page control in %s', locale => {
        const source = legalPageCopy('zh')
        const translated = legalPageCopy(locale)
        for (const key of Object.keys(source) as Array<keyof typeof source>) {
            expect(translated[key], key).not.toBe(source[key])
        }
        if (locale !== 'ja') expect(Object.values(translated).join(' ')).not.toMatch(/\p{Script=Han}/u)
    })

    it.each(locales.filter(locale => locale !== 'zh'))('fully translates the script import dialog in %s', locale => {
        const description = '上传文档或粘贴内容后，系统会直接按集、场次和画面快速解析；大纲、正文、剧本和分镜会分别导入到对应阶段。'
        const placeholder = '粘贴你的剧本内容...\n\n例如：\n第1集 命运的相遇\n女主林晓在雨夜的地铁站遇到了神秘的男子...\n\n或者：\n林晓（低头哭泣）：为什么是我...\n男主（走过来）：别怕，我在这里'

        expect(translateMessage(locale, description)).not.toBe(description)
        expect(translateMessage(locale, placeholder)).not.toBe(placeholder)
    })

    it.each(locales.filter(locale => locale !== 'zh'))('fully translates critical landing copy in %s', locale => {
        const source = 'AI 短剧生成器'
        const translated = translateMessage(locale, source)
        expect(translated).not.toBe(source)
        expect(translated.trim().length).toBeGreaterThan(8)
    })

    it.each(locales.filter(locale => locale !== 'zh'))('translates every global project genre in %s', locale => {
        for (const genre of PROJECT_GENRES) expect(translateMessage(locale, genre.label)).not.toBe(genre.label)
    })

    it.each(locales.filter(locale => locale !== 'zh'))('translates recharge badges in %s', locale => {
        for (const badge of ['热门', '超值']) {
            expect(translateMessage(locale, badge)).not.toBe(badge)
            expect(translateMessage(locale, badge).trim()).not.toBe('')
        }
    })

    it('never partially translates unknown Chinese content', () => {
        const source = 'AI 完全未知的中文业务内容 628309'
        expect(translateMessage('en', source)).toBe(source)
        expect(translateMessage('fr', source)).toBe(source)
    })

    it('translates fully covered dynamic labels without mixing source text', () => {
        expect(translateMessage('en', '已解析：demo.pdf')).toBe('Parsed:demo.pdf')
    })

    it('backtracks across overlapping catalog fragments to avoid Chinese in dynamic labels', () => {
        const translated = translateMessage('en', '日系动漫风格预览')
        expect(translated).not.toMatch(/\p{Script=Han}/u)
        expect(translated).toContain('Japanese animation')
        expect(translated).toContain('style preview')
    })

    it.each(locales)('preserves chapter-length English text without overflowing in %s', locale => {
        const source = 'In the pitch-black void beyond the orbit of Jupiter.\n'.repeat(800)
        expect(translateMessage(locale, source)).toBe(source)
    })

    it('translates covered fragments around long Unicode values without overflowing', () => {
        const filename = 'Jupiter-🪐-'.repeat(4000) + '.txt'
        expect(translateMessage('en', `已解析：${filename}`)).toBe(`Parsed:${filename}`)
        expect(translateMessage('en', `${filename} 已解析：demo.pdf`)).toBe(`${filename} Parsed:demo.pdf`)
    })

    it('preserves the entire long message when a trailing fragment is unknown', () => {
        const source = `已解析：${'Jupiter-🪐-'.repeat(4000)} 完全未知的中文业务内容`
        expect(translateMessage('en', source)).toBe(source)
    })

    it('backtracks across repeated overlapping fragments without overflowing', () => {
        const fragment = '日系动漫风格预览'
        const source = `${fragment} 🪐 `.repeat(4000)
        expect(translateMessage('en', source)).toBe(`${translateMessage('en', fragment)} 🪐 `.repeat(4000))
    })

    it.each(locales.filter(locale => locale !== 'zh'))('translates manual generation concurrency feedback in %s', locale => {
        for (const source of ['当前账号最多同时处理 15 个图片生成任务，请等待正在处理的图片完成后再试。', '当前账号最多同时处理 10 个视频生成任务，请等待正在处理的视频完成后再试。']) {
            expect(translateMessage(locale, source)).not.toBe(source)
        }
    })

    it.each(locales.filter(locale => locale !== 'en'))('translates visible English API errors in %s', locale => {
        const translated = translateMessage(locale, 'Project not found')
        expect(translated).not.toBe('Project not found')
        expect(translated.trim().length).toBeGreaterThan(3)
    })

    it('translates English UI text into Chinese instead of treating Chinese as a no-op locale', () => {
        expect(translateMessage('zh', 'Please Confirm')).toBe('请确认')
    })

    it.each(locales)('keeps model and product names unchanged in %s', locale => {
        expect(translateMessage(locale, 'Nano Banana')).toBe('Nano Banana')
        expect(translateMessage(locale, 'Google Veo 3')).toBe('Google Veo 3')
        expect(translateMessage(locale, 'veo-3.1-generate-001')).toBe('veo-3.1-generate-001')
        expect(translateMessage(locale, 'seedream-5-0-lite')).toBe('seedream-5-0-lite')
        expect(translateMessage(locale, 'Happy Horse 任务')).toContain('Happy Horse')
        expect(translateMessage(locale, 'Himodels')).toBe('Himodels')
    })

    it.each(locales.filter(locale => locale !== 'zh'))('translates the direct-provider source label in %s', locale => {
        expect(translateMessage(locale, '厂商直连')).not.toBe('厂商直连')
    })

    it.each(locales)('uses one display language throughout the selector for %s', locale => {
        const names = locales.map(item => localeDisplayName(locale, item))
        expect(names).toHaveLength(locales.length)
        expect(names.every(Boolean)).toBe(true)
    })

    it.each(locales)('round-trips locale paths for %s', locale => {
        const localized = localizePath('/projects/123?tab=novel', locale)
        expect(localeFromPathname(localized)).toBe(locale)
        expect(stripLocale(localized)).toBe('/projects/123?tab=novel')
        expect(localized.startsWith('/en/')).toBe(false)
    })

    it('normalizes an explicit English prefix back to the root locale', () => {
        expect(stripLocale('/en/projects/123')).toBe('/projects/123')
        expect(localizePath('/en/projects/123', 'fr')).toBe('/fr/projects/123')
        expect(localizePath('/en/projects/123', 'en')).toBe('/projects/123')
    })

    it('restores the stored locale for an unprefixed URL while respecting an explicit locale', () => {
        expect(resolveRequestLocale('projects', null, 'zh')).toBe('zh')
        expect(resolveRequestLocale('projects', null, 'fr')).toBe('fr')
        expect(resolveRequestLocale('en', null, 'zh')).toBe('en')
        expect(resolveRequestLocale('ja', null, 'zh')).toBe('ja')

        expect(storedLocaleForUnlocalizedPath('/projects', 'zh')).toBe('zh')
        expect(storedLocaleForUnlocalizedPath('/projects', 'en')).toBeNull()
        expect(storedLocaleForUnlocalizedPath('/fr/projects', 'zh')).toBeNull()
        expect(storedLocaleForUnlocalizedPath('/projects', 'invalid')).toBeNull()
    })

    it.each(locales)('has dedicated metadata for every public feature page in %s', locale => {
        expect(Object.keys(SEO_FEATURE_LOCALE[locale]).sort()).toEqual([...seoPageSlugs].sort())
        for (const slug of seoPageSlugs) {
            expect(SEO_FEATURE_LOCALE[locale][slug].title.length).toBeGreaterThan(20)
            expect(SEO_FEATURE_LOCALE[locale][slug].description.length).toBeGreaterThan(30)
        }
    })
})
