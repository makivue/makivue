import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertTextModelConfigured, chat, getConfiguredTextModelName, normalizeTextModel } from './llm'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { HIMODELS_TEXT_MODELS } from '@/lib/himodels-models'
import { isAvailableTextModel, TEXT_MODEL_OPTIONS } from '@/lib/text-model-options'
import { modelDisplayName } from '@/lib/model-display'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: mocks.findUnique } } }))

describe('selected text model configuration preflight', () => {
    beforeEach(() => {
        for (const name of [
            'OPENAI_API_KEY',
            'AZURE_OPENAI_TEXT_API_KEY',
            'AZURE_API_KEY',
            'GPT5_API_KEY',
            'HIMODELS_DEV_API_KEY',
            'HIMODELS_SHARED_API_KEY',
            'HIMODELS_API_KEY',
            'NANO_BANANA_SERVICE_ACCOUNT_JSON',
            'NANO_BANANA_SERVICE_ACCOUNT_JSON_B64',
            'NANO_BANANA_CREDENTIALS_PATH',
            'GOOGLE_APPLICATION_CREDENTIALS'
        ])
            vi.stubEnv(name, '')
        vi.stubEnv('NODE_ENV', 'production')
        vi.spyOn(globalThis, 'fetch')
    })

    afterEach(() => {
        expect(fetch).not.toHaveBeenCalled()
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it.each(['gemini-3.7-flash', 'gemini:gemini-3.7-flash', 'gpt-5.4-shortdrama'])('rejects %s without its credentials before any provider request', async model => {
        await expect(assertTextModelConfigured(model)).rejects.toThrow(/未配置|not configured|credentials/i)
    })

    it('does not use old Azure credentials when a personal key is missing', async () => {
        vi.stubEnv('GPT5_API_KEY', 'old-gpt-key')
        vi.stubEnv('AZURE_API_KEY', 'old-azure-key')
        vi.stubEnv('AZURE_OPENAI_TEXT_ENDPOINT', 'https://fixture.openai.azure.com')
        await expect(assertTextModelConfigured('gpt-4o')).rejects.toThrow('Set your own OPENAI_API_KEY')
        await expect(chat([{ role: 'user', content: 'test' }], { model: 'gpt-4o' })).rejects.toThrow('Set your own OPENAI_API_KEY')
    })

    it('checks the selected provider independently of other configured providers', async () => {
        vi.stubEnv('HIMODELS_API_KEY', 'fixture-personal')
        await expect(assertTextModelConfigured('gemini-3.7-flash')).resolves.toBeUndefined()
        await expect(assertTextModelConfigured('gpt-5.4-shortdrama')).rejects.toThrow('not configured')
    })
})

describe('Personal Azure credentials', () => {
    beforeEach(() => {
        mocks.findUnique.mockReset().mockResolvedValue(null)
        for (const name of ['OPENAI_API_KEY', 'AZURE_OPENAI_TEXT_API_KEY', 'AZURE_API_KEY', 'OPENAI_BASE_URL', 'AZURE_OPENAI_TEXT_ENDPOINT', 'AZURE_OPENAI_API_VERSION', 'OPENAI_MODEL'])
            vi.stubEnv(name, undefined)
        vi.stubEnv('AZURE_OPENAI_TEXT_API_KEY', 'personal-azure-key')
        vi.stubEnv('AZURE_OPENAI_TEXT_ENDPOINT', 'https://fixture.openai.azure.com')
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ output_text: 'ok', choices: [{ message: { content: 'ok' } }] })))
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it('preserves the Azure endpoint and model when Settings is empty', async () => {
        expect(await getConfiguredTextModelName()).toBe('gpt-5.4-shortdrama')
        expect(await chat([{ role: 'user', content: 'test' }])).toBe('ok')
        expect(fetch).toHaveBeenCalledWith(
            'https://fixture.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
            expect.objectContaining({
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer personal-azure-key' },
                body: expect.stringContaining('"model":"gpt-5.4-shortdrama"')
            })
        )
    })

    it('ignores database keys and endpoints while reading only the selected model', async () => {
        mocks.findUnique.mockResolvedValue({ apiKey: 'settings-openai-key', baseUrl: 'https://stale.example', modelName: null })
        await chat([{ role: 'user', content: 'test' }])
        expect(mocks.findUnique).toHaveBeenCalledWith({ where: { provider: 'openai' }, select: { modelName: true } })
        expect(fetch).toHaveBeenCalledWith(
            'https://fixture.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
            expect.objectContaining({
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer personal-azure-key' }
            })
        )
    })

    it('keeps an explicit OpenAI credential paired with its own endpoint when Azure is also configured', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'runtime-openai-key')
        await chat([{ role: 'user', content: 'test' }])
        expect(fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/chat/completions',
            expect.objectContaining({
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer runtime-openai-key' }
            })
        )
    })

    it('can still select the default when the Settings database is unavailable', async () => {
        mocks.findUnique.mockRejectedValue(new Error('database unavailable'))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(await getConfiguredTextModelName()).toBe('gpt-5.4-shortdrama')
    })

    it('applies the configured Azure endpoint, API version and deployment together', async () => {
        vi.stubEnv('AZURE_OPENAI_TEXT_ENDPOINT', 'https://custom.openai.azure.com')
        vi.stubEnv('AZURE_OPENAI_API_VERSION', '2026-01-01-preview')
        vi.stubEnv('OPENAI_MODEL', 'custom-deployment')
        await chat([{ role: 'user', content: 'test' }])
        expect(fetch).toHaveBeenCalledWith(
            'https://custom.openai.azure.com/openai/responses?api-version=2026-01-01-preview',
            expect.objectContaining({ body: expect.stringContaining('"model":"custom-deployment"') })
        )
    })
})

describe('text model routing', () => {
    it.each(['gpt-5.4-shortdrama', 'gpt-5.5-shortdrama'])('keeps internal Azure text model %s routable but hides it from selectors', model => {
        expect(normalizeTextModel(model)).toBe(model)
        expect(TEXT_MODEL_OPTIONS.map(option => option.value)).not.toContain(model)
    })

    it('does not hard-code prompt expansion to one GPT deployment', () => {
        const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/expand-prompt/route.ts'), 'utf8')
        expect(route).toContain('getConfiguredTextModelName()')
        expect(route).not.toContain("const MODEL = 'gpt-5.5-shortdrama'")
    })

    it('uses the shared text-model catalog in every model switcher', () => {
        const switcher = fs.readFileSync(path.join(process.cwd(), 'src/components/ModelSwitcher.tsx'), 'utf8')
        expect(switcher).toContain('import { TEXT_MODEL_OPTIONS')
    })

    it('offers every Himodels text model in the model switcher and settings', () => {
        const switcher = fs.readFileSync(path.join(process.cwd(), 'src/components/ModelSwitcher.tsx'), 'utf8')
        const settings = fs.readFileSync(path.join(process.cwd(), 'src/app/settings/page.tsx'), 'utf8')

        expect(settings).toContain('TEXT_MODEL_OPTIONS.map')
        for (const model of HIMODELS_TEXT_MODELS) {
            expect(switcher).toContain('TEXT_MODEL_OPTIONS.filter')
            expect(TEXT_MODEL_OPTIONS).toContainEqual(expect.objectContaining({ value: model, label: modelDisplayName(model), source: 'himodels' }))
        }
    })

    it('does not repeat the selected model provider in the closed trigger', () => {
        const switcher = fs.readFileSync(path.join(process.cwd(), 'src/components/ModelSwitcher.tsx'), 'utf8')
        expect(switcher).toContain('{prefix && <span')
        expect(switcher).not.toContain('displayPrefix')
        expect(switcher).not.toContain("prefix = 'GPT'")
    })

    it('shows only task-specific model selectors in the project workspace', () => {
        const workspace = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
        const novelTab = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/NovelTab.tsx'), 'utf8')

        expect(workspace).not.toContain("import ModelSwitcher from '@/components/ModelSwitcher'")
        expect(novelTab).toContain('title="架构与大纲模型"')
        expect(novelTab).toContain('prefix="架构/大纲"')
        expect(novelTab).toContain('providerKey="chapter_model"')
        expect(novelTab).toContain('prefix="正文"')
        expect(novelTab).toContain('providerKey="script_model"')
        expect(novelTab).toContain('prefix="拆剧本"')
    })

    it('labels direct-provider Gemini without exposing Google as the group name and upgrades removed IDs', () => {
        expect(TEXT_MODEL_OPTIONS.filter(option => option.source === 'direct').map(option => option.value)).toEqual(['gpt-4o', 'gemini:gemini-3.7-flash'])
        expect(TEXT_MODEL_OPTIONS).not.toContainEqual(expect.objectContaining({ source: 'Google' }))
        expect(normalizeTextModel(GEMINI_FLASH_TEXT_MODEL_ID)).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-3.1-pro-preview')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-3.1-flash-lite-preview')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-3.1-flash-lite')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-3.6-flash')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-3.5-flash')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-2.5-pro')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(normalizeTextModel('gemini:gemini-2.5-flash')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
        expect(isAvailableTextModel('gemini:gemini-3.1-pro-preview')).toBe(false)
        expect(isAvailableTextModel('gemini:gemini-3.1-flash-lite-preview')).toBe(false)
        expect(isAvailableTextModel('gemini:gemini-3.1-flash-lite')).toBe(false)
        expect(isAvailableTextModel('gemini:gemini-2.5-pro')).toBe(false)
        expect(isAvailableTextModel('gemini:gemini-2.5-flash')).toBe(false)
    })

    it.each(['gemini-3.7-flash'])('keeps Himodels text model %s for provider routing', model => {
        expect(normalizeTextModel(model)).toBe(model)
    })

    it.each([
        ['gemini-3.1-pro-preview', 'gemini-3.7-flash'],
        ['gemini-3.1-flash-lite-preview', 'gemini-3.7-flash'],
        ['gemini-3.6-flash', 'gemini-3.7-flash'],
        ['gemini-3.5-flash', 'gemini-3.7-flash'],
        ['gemini-2.5-pro', 'gemini-3.7-flash'],
        ['gemini-2.5-flash', 'gemini-3.7-flash'],
        ['claude-opus-4-7', 'gemini-3.7-flash'],
        ['deepseek-v4-flash', 'gemini-3.7-flash'],
        ['deepseek-v4-pro', 'gemini-3.7-flash'],
        ['gpt-5.6-terra', 'gemini-3.7-flash'],
        ['gpt-5.6-sol', 'gemini-3.7-flash']
    ])('replaces removed or legacy Himodels text model %s with %s', (legacyModel, currentModel) => {
        expect(normalizeTextModel(legacyModel)).toBe(currentModel)
        expect(isAvailableTextModel(legacyModel)).toBe(false)
    })
})
