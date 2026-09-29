import { expect, test } from '@playwright/test'
import { issueSessionToken } from '../src/lib/session-token'
import { localizedLocales } from '../src/i18n/config'

const authorization = `Bearer ${issueSessionToken({ userId: 1n, email: 'e2e@example.test' })}`

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

    test('rejects retired TTS settings before any database write', async ({ request }) => {
        const response = await request.post('/api/settings', {
            headers: { Authorization: authorization },
            data: { provider: 'tts_provider', modelName: 'openai' }
        })
        expect(response.status()).toBe(400)
        await expect(response.json()).resolves.toMatchObject({ success: false, error: '不支持的配置项' })
    })

    test('keeps image and video generation endpoints behind authentication', async ({ request }) => {
        for (const pathname of ['/api/storyboards/1/images/generate', '/api/storyboards/1/video/generate']) {
            const response = await request.post(pathname, { data: { type: pathname.includes('/images/') ? 'first_frame' : 'video' } })
            expect(response.status()).toBe(401)
        }
    })
})
