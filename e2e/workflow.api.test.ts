import { expect, test } from '@playwright/test'
import { localizedLocales } from '../src/i18n/config'

test.describe('short-drama workflow surface', () => {
    test('serves localized pages without a self-redirect after an internal rewrite', async ({ request }) => {
        for (const locale of localizedLocales) {
            const response = await request.get(`/${locale}/faq`, { maxRedirects: 0 })
            expect(response.status(), locale).toBe(200)
            expect(await response.text()).toContain(`lang="${locale}"`)
        }
    })

    test('serves the native-audio workflow without retired TTS controls', async ({ request }) => {
        const [featureResponse, settingsResponse] = await Promise.all([request.get('/features/ai-video-generator'), request.get('/settings')])
        expect(featureResponse.ok()).toBeTruthy()
        expect(settingsResponse.ok()).toBeTruthy()

        const visibleSource = `${await featureResponse.text()} ${await settingsResponse.text()}`
        expect(visibleSource).toContain('Native audio and assembly')
        expect(visibleSource).not.toContain('后期配音（TTS）')
        expect(visibleSource).not.toContain('TTS Provider')
        expect(visibleSource).not.toContain('Wan 驱动音频')
    })

    test('rejects retired TTS settings before writing local preferences', async ({ request }) => {
        const response = await request.post('/api/settings', {
            data: { provider: 'tts_provider', modelName: 'openai' }
        })
        expect(response.status()).toBe(400)
        await expect(response.json()).resolves.toMatchObject({ success: false, error: '不支持的配置项' })
    })

    test('rejects cross-origin generation requests before calling model suppliers', async ({ request }) => {
        for (const pathname of ['/api/storyboards/1/images/generate', '/api/storyboards/1/video/generate']) {
            const response = await request.post(pathname, {
                headers: { Origin: 'https://untrusted.test', 'Sec-Fetch-Site': 'cross-site' },
                data: { type: pathname.includes('/images/') ? 'first_frame' : 'video' }
            })
            expect(response.status()).toBe(403)
            await expect(response.json()).resolves.toMatchObject({ error: 'Cross-origin access is disabled' })
        }
    })
})
