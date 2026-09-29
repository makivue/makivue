import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectModelConfiguration, loadModelEnvironment } from '../../scripts/model-config.mjs'

const account = { project_id: 'example-project', client_email: 'service@example.test', private_key: 'fixture-private-key' }
const complete = {
    OPENAI_API_KEY: 'fixture-openai',
    AZURE_OPENAI_TEXT_API_KEY: 'fixture-azure',
    AZURE_OPENAI_TEXT_ENDPOINT: 'https://fixture.openai.azure.com',
    HIMODELS_API_KEY: 'fixture-personal',
    DASHSCOPE_API_KEY: 'fixture-dashscope',
    SEEDANCE_API_KEY: 'fixture-seedance',
    NANO_BANANA_SERVICE_ACCOUNT_JSON_B64: Buffer.from(JSON.stringify(account)).toString('base64'),
    VOLCENGINE_ACCESS_KEY: 'fixture-access',
    VOLCENGINE_SECRET_KEY: 'fixture-secret'
}
const roots: string[] = []
function fixture(env: Record<string, string> = complete) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'all-model-config-'))
    roots.push(root)
    fs.writeFileSync(
        path.join(root, '.env'),
        Object.entries(env)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join('\n'),
        { mode: 0o600 }
    )
    return root
}
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

describe('personal model configuration', () => {
    it.each(['development', 'test', 'production'])('loads every primary provider from one .env in %s', environment => {
        const loaded = loadModelEnvironment(fixture(), { NODE_ENV: environment })
        const checks = inspectModelConfiguration(loaded.env)
        expect(checks.every(check => check.optional)).toBe(true)
        expect(checks.slice(0, -1).every(check => check.configured)).toBe(true)
        expect(checks.at(-1)).toMatchObject({ configured: false })
    })

    it('preserves explicitly injected personal keys and local data settings', () => {
        const injected = { OPENAI_API_KEY: 'injected', LOCAL_DATA_DIR: '/tmp/personal-model-data' }
        expect(loadModelEnvironment(fixture(), injected).env).toEqual({ ...complete, ...injected })
    })

    it('validates server-injected credentials when the image has no private .env file', () => {
        const root = fixture()
        fs.unlinkSync(path.join(root, '.env'))
        const loaded = loadModelEnvironment(root, complete)
        expect(loaded.exists).toBe(false)
        expect(
            inspectModelConfiguration(loaded.env)
                .slice(0, -1)
                .every(check => check.configured)
        ).toBe(true)
        const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/check-model-config.mjs'), '--environment=production'], { cwd: root, env: complete, encoding: 'utf8' })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('HiModels 文本 / 图片 / 视频: 配置完整')
        for (const value of Object.values(complete)) expect(result.stdout + result.stderr).not.toContain(value)
    })

    it('does not accept legacy internal keys as personal provider configuration', () => {
        const checks = inspectModelConfiguration({
            GPT5_API_KEY: 'old-gpt',
            AZURE_API_KEY: 'old-azure',
            HIMODELS_DEV_API_KEY: 'old-dev',
            HIMODELS_SHARED_API_KEY: 'old-shared',
            HAPPY_HORSE_API_KEY: 'old-dashscope',
            VOLCENGINE_ARK_API_KEY: 'old-ark',
            ARK_API_KEY: 'old-ark',
            BYTEPLUS_ARK_API_KEY: 'old-byteplus'
        })
        expect(checks.every(check => !check.configured)).toBe(true)
    })

    it('requires an Azure endpoint and matching key without borrowing the OpenAI key', () => {
        for (const env of [{ AZURE_OPENAI_TEXT_API_KEY: 'own-key' }, { OPENAI_API_KEY: 'openai-key', AZURE_OPENAI_TEXT_ENDPOINT: 'https://fixture.openai.azure.com' }]) {
            expect(inspectModelConfiguration(env).find(check => check.label === 'Azure OpenAI')).toMatchObject({ configured: false })
        }
    })

    it('rejects incomplete Google credentials even when the variable is present', () => {
        const checks = inspectModelConfiguration({ ...complete, NANO_BANANA_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{"project_id":"example"}').toString('base64') })
        expect(checks.find(check => check.label.includes('Gemini'))).toMatchObject({ configured: false })
    })

    it('allows optional Kling only when both halves of the credential are configured', () => {
        expect(inspectModelConfiguration({ ...complete, KLING_ACCESS_KEY: 'fixture' }).at(-1)).toMatchObject({ configured: false })
        expect(inspectModelConfiguration({ ...complete, KLING_API_KEY: 'fixture-access:fixture-secret' }).at(-1)).toMatchObject({ configured: true })
    })

    it('requires the personal file only when explicitly requested', () => {
        const root = fixture()
        fs.unlinkSync(path.join(root, '.env'))
        const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/check-model-config.mjs'), '--require-file'], { cwd: root, env: {}, encoding: 'utf8' })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('请复制 .env.example')
    })

    it('checks the local configuration without exposing any credential in output', () => {
        const root = fixture()
        const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/check-model-config.mjs'), '--require-file'], { cwd: root, env: {}, encoding: 'utf8' })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('Kling 对照测试（可选）: 未启用')
        for (const value of Object.values(complete)) expect(result.stdout + result.stderr).not.toContain(value)
    })

    it('warns at startup without preventing users from opening the application', () => {
        const root = fixture({})
        const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/check-model-config.mjs'), '--warn-only'], { cwd: root, env: {}, encoding: 'utf8' })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('未启用')
    })
})
