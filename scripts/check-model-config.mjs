import { inspectModelConfiguration, loadModelEnvironment } from './model-config.mjs'

const args = process.argv.slice(2)
const environment = args.find(arg => arg.startsWith('--environment='))?.split('=')[1] || process.env.NODE_ENV || 'production'
if (!['development', 'test', 'production'].includes(environment)) throw new Error('模型配置检查仅支持 development / test / production')

try {
    const { env, exists } = loadModelEnvironment()
    if (args.includes('--require-file') && !exists) {
        throw new Error('请复制 .env.example 为 .env，并填写自己需要使用的模型密钥。')
    }
    const checks = inspectModelConfiguration(env)
    for (const check of checks) {
        console.log(`[models] ${check.label}: ${check.configured ? '配置完整' : `${check.optional ? '未启用' : '缺少配置'} — ${check.setting}`}`)
    }
    if (checks.some(check => !check.configured && !check.optional)) {
        throw new Error('模型配置不完整。请在 .env 填写对应供应商的个人密钥并重启本地服务。检查不会输出密钥或请求模型。')
    }
} catch (error) {
    // Never echo parser/input errors, which may contain credentials.
    console.error(error instanceof Error && /^(请复制|模型配置不完整)/.test(error.message) ? error.message : '无法读取统一模型配置 .env，请检查文件格式及读取权限。')
    process.exitCode = args.includes('--warn-only') ? 0 : 1
}
