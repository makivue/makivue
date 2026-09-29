import { describe, expect, it } from 'vitest'
import { extractMessages } from './i18n-source-messages.mjs'

describe('translation source discovery', () => {
    it('collects single-word English keys explicitly passed to translation helpers', () => {
        const messages = extractMessages('example.tsx', "const label = t('Help'); const other = translateMessage(locale, 'Theme')")
        expect(messages).toEqual(new Set(['Help', 'Theme']))
    })

    it('collects conditional UI labels and accessibility attributes', () => {
        const messages = extractMessages('example.tsx', '<button aria-label="关闭主题设置">{t(open ? "关闭" : "打开")}</button>')
        expect(messages).toEqual(new Set(['关闭主题设置', '关闭', '打开']))
    })

    it('does not treat English identifiers and model configuration as UI copy', () => {
        const messages = extractMessages('example.ts', "const model = 'seedream-5-0-lite'; const path = '/api/projects'; const query = 'select id from projects'")
        expect(messages.size).toBe(0)
    })

    it('excludes model inputs and their local helper text while retaining shared error messages', () => {
        const messages = extractMessages(
            'src/services/example.ts',
            `
            const reason = '图片上传失败'
            const instruction = '你是专业导演，只输出 JSON'
            function context() { return '仅供模型参考' }
            const prompt = instruction + context() + reason
            chat([{ role: 'system', content: prompt }])
            throw new Error(reason)
        `
        )
        expect(messages).toEqual(new Set(['图片上传失败']))
    })

    it('keeps UI and API errors even when the same copy is also logged', () => {
        const messages = extractMessages(
            'src/app/api/example/route.ts',
            `
            console.info('内部调试日志')
            console.error('Project not found')
            return apiError('Project not found', 404)
        `
        )
        expect(messages).toEqual(new Set(['Project not found']))
    })

    it('discovers English toast fallbacks, dialog labels, and metadata', () => {
        const messages = extractMessages(
            'example.tsx',
            `
            pushToast('error', error.message ?? 'Upload failed')
            confirm({ title: 'Delete project', message: 'This cannot be undone', confirmText: 'Delete' })
            localizedPrivateMetadata('My projects', 'Manage your projects')
        `
        )
        expect(messages).toEqual(new Set(['Upload failed', 'Delete project', 'This cannot be undone', 'Delete', 'My projects', 'Manage your projects']))
    })

    it('does not remove a placeholder just because it contains prompt instructions', () => {
        const messages = extractMessages('example.tsx', '<textarea placeholder="你是专业导演，只输出 JSON" />')
        expect(messages).toEqual(new Set(['你是专业导演，只输出 JSON']))
    })
})
