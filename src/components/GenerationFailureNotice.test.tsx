import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import GenerationFailureNotice from './GenerationFailureNotice'

vi.mock('@/i18n/I18nProvider', () => ({
    useI18n: () => ({ t: (source: string) => source })
}))

describe('GenerationFailureNotice', () => {
    it('offers direct retry for a previous runtime failure without requiring chapter edits', () => {
        const html = renderToStaticMarkup(
            <GenerationFailureNotice
                errorMessage="剧本质量检查未通过：按对白语速和可见动作估算仅 214.9 秒，明显低于 5-8 分钟"
                taskLabel="拆剧本"
                onEdit={vi.fn()}
                onRetry={vi.fn()}
                retryLabel="重新拆本集"
            />
        )

        expect(html).toContain('上次拆本因估算时长暂停')
        expect(html).not.toContain('返回章节修改')
        expect(html).toContain('重新拆本集')
    })

    it('shows recovery actions while keeping provider details collapsed', () => {
        const html = renderToStaticMarkup(
            <GenerationFailureNotice
                errorMessage={'No image in Banana response. Raw: {"promptFeedback":{"blockReason":"SAFETY"}}'}
                provider="banana"
                onEdit={vi.fn()}
                onRetry={vi.fn()}
            />
        )

        expect(html).toContain('图片内容安全检查未通过')
        expect(html).toContain('定位并修改图像描述')
        expect(html).toContain('名牌、徽章、臂章')
        expect(html).not.toContain('重新生成当前步骤')
        expect(html).toContain('<details')
        expect(html).toContain('技术详情（提供给管理员）')
    })

    it('does not offer a retry loop for storage permission failures', () => {
        const html = renderToStaticMarkup(
            <GenerationFailureNotice
                errorMessage="上传 local storage 失败：You have no right to access this object because of bucket acl."
                provider="local"
                onRetry={vi.fn()}
            />
        )

        expect(html).toContain('平台存储暂时不可用')
        expect(html).toContain('需要管理员处理')
        expect(html).not.toContain('<button')
    })

    it('shows manual editing guidance for oversized dialogue', () => {
        const html = renderToStaticMarkup(
            <GenerationFailureNotice
                errorMessage="Wan 2.7 单个分镜最多支持 15 秒音频，当前台词为 21.0 秒；自动加速会超过自然语速范围。"
                provider="wanx"
                onRetry={vi.fn()}
            />
        )

        expect(html).toContain('台词超出模型时长')
        expect(html).toContain('手动缩短台词')
        expect(html).not.toContain('重新生成当前步骤')
    })
})

describe('model configuration messages shown to users', () => {
    it.each(['Himodels API key 未配置，请在 .env 填写自己的 HIMODELS_API_KEY', '拆剧本模型未配置。请联系管理员完成模型配置，或选择其他已配置的模型后重试。'])(
        'shows an actionable missing-model notice for old and new server responses',
        errorMessage => {
            const html = renderToStaticMarkup(createElement(GenerationFailureNotice, { errorMessage, taskLabel: '拆剧本', onRetry: () => {} }))
            const visibleNotice = html.replace(/<details[\s\S]*?<\/details>/g, '')
            expect(visibleNotice).toContain('拆剧本模型未配置')
            expect(visibleNotice).toContain('当前所选模型尚未配置服务凭证')
            expect(visibleNotice).toContain('请联系管理员完成模型配置')
            expect(visibleNotice).toContain('选择其他已配置的模型后重试')
            expect(visibleNotice).not.toMatch(/拆分已暂停|正在重试|前文|质量检查|HIMODELS_|重新生成当前步骤/)
            expect(html).not.toContain('<details open')
        }
    )

    it.each([
        ['OpenAI API key invalid', '拆剧本模型配置无效'],
        ['Gemini 凭证权限不足 PERMISSION_DENIED', '拆剧本模型无访问权限']
    ])('distinguishes invalid credentials and permissions from missing configuration', (errorMessage, title) => {
        const html = renderToStaticMarkup(createElement(GenerationFailureNotice, { errorMessage, taskLabel: '拆剧本' }))
        expect(html).toContain(title)
        expect(html).not.toContain('拆剧本模型未配置')
    })
})
