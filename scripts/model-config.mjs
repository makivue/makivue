import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'dotenv'

const first = (env, ...keys) => keys.map(key => env[key]?.trim()).find(Boolean)

/** Read the single private configuration without overwriting injected values. */
export function loadModelEnvironment(root = process.cwd(), injected = process.env) {
    const file = path.join(root, '.env')
    const exists = fs.existsSync(file)
    return { file, exists, env: { ...(exists ? parse(fs.readFileSync(file)) : {}), ...injected } }
}

/** Configuration checks only: never call a provider or print a credential. */
export function inspectModelConfiguration(env) {
    let googleConfigured = false
    try {
        const inline = first(env, 'NANO_BANANA_SERVICE_ACCOUNT_JSON')
        const encoded = first(env, 'NANO_BANANA_SERVICE_ACCOUNT_JSON_B64')
        const credentialPath = first(env, 'NANO_BANANA_CREDENTIALS_PATH', 'GOOGLE_APPLICATION_CREDENTIALS')
        const raw = inline || (encoded ? Buffer.from(encoded, 'base64').toString('utf8') : credentialPath ? fs.readFileSync(credentialPath, 'utf8') : '')
        const account = JSON.parse(raw)
        googleConfigured = ['client_email', 'project_id', 'private_key'].every(key => typeof account[key] === 'string' && account[key].trim())
    } catch {
        // JSON errors can contain private-key text. Report field names only.
    }
    const packedKling = first(env, 'KLING_API_KEY')?.split(':')
    const klingConfigured = packedKling ? Boolean(packedKling[0]?.trim() && packedKling.slice(1).join(':').trim()) : Boolean(first(env, 'KLING_ACCESS_KEY') && first(env, 'KLING_SECRET_KEY'))
    return [
        { label: 'OpenAI / 兼容供应商', configured: Boolean(first(env, 'OPENAI_API_KEY')), setting: 'OPENAI_API_KEY' },
        {
            label: 'Azure OpenAI',
            configured: Boolean(first(env, 'AZURE_OPENAI_TEXT_API_KEY') && first(env, 'AZURE_OPENAI_TEXT_ENDPOINT')),
            setting: 'AZURE_OPENAI_TEXT_API_KEY / AZURE_OPENAI_TEXT_ENDPOINT'
        },
        { label: 'HiModels 文本 / 图片 / 视频', configured: Boolean(first(env, 'HIMODELS_API_KEY')), setting: 'HIMODELS_API_KEY' },
        { label: 'Gemini / Nano Banana（Google Vertex AI）', configured: googleConfigured, setting: 'NANO_BANANA_SERVICE_ACCOUNT_JSON_B64（完整服务账号）' },
        { label: 'Wan / Qwen（DashScope）', configured: Boolean(first(env, 'DASHSCOPE_API_KEY')), setting: 'DASHSCOPE_API_KEY' },
        { label: 'Seedance 2.0 / 2.5', configured: Boolean(first(env, 'SEEDANCE_API_KEY')), setting: 'SEEDANCE_API_KEY' },
        {
            label: 'Seedance 官方素材库',
            configured: Boolean(
                first(env, 'VOLCENGINE_ACCESS_KEY', 'VOLCSTACK_ACCESS_KEY_ID', 'VOLCSTACK_ACCESS_KEY', 'ARK_ACCESS_KEY_ID') &&
                first(env, 'VOLCENGINE_SECRET_KEY', 'VOLCSTACK_SECRET_ACCESS_KEY', 'VOLCSTACK_SECRET_KEY', 'ARK_SECRET_ACCESS_KEY')
            ),
            setting: 'VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY'
        },
        { label: 'Kling 对照测试（可选）', configured: klingConfigured, setting: 'KLING_ACCESS_KEY / KLING_SECRET_KEY', optional: true }
    ].map(check => ({ ...check, optional: true }))
}
