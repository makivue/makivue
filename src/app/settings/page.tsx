'use client'

import { useEffect, useState } from 'react'
import Link from '@/i18n/navigation'
import { ArrowLeft, Save, Settings, Languages } from 'lucide-react'
import { IMAGE_QUALITY_OPTIONS, normalizeImageQuality, type ImageQuality } from '@/lib/image-quality'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { pushToast } from '@/components/Toast'
import { normalizeVideoLanguage, type VideoLanguage } from '@/lib/video-language'
import { GENERATION_MODEL_SOURCES, GENERATION_MODEL_SOURCE_LABELS, generationModelSource, modelDisplayName } from '@/lib/model-display'
import { normalizeLegacyHiModelsModelId } from '@/lib/himodels-models'
import { useI18n } from '@/i18n/I18nProvider'
import { TEXT_MODEL_OPTIONS } from '@/lib/text-model-options'
import ModelSourceBadge from '@/components/ModelSourceBadge'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import HomeLogoLink from '@/components/HomeLogoLink'

interface ServiceConfig {
    provider: string
    modelName: string | null
}

const IMAGE_PROVIDERS = [
    {
        value: 'banana',
        label: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
        desc: '最新通用图片模型，支持 1K / 2K / 4K 与多参考图；速度与质量均衡'
    },
    { value: 'qwen-image-3.0-pro', label: 'Qwen-Image-3.0-Pro', desc: '阿里百炼图片模型，支持文生图和参考图' },
    { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', desc: 'Himodels Gemini Flash 图像模型，支持参考图' },
    { value: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite', desc: 'Himodels Seedream 5.0 Lite 文生图，固定 2K' }
]

const OPENAI_MODEL_PRESETS = TEXT_MODEL_OPTIONS.map(option => ({
    ...option,
    desc: option.source === 'himodels' ? '通过 Himodels 统一接口调用' : option.value.startsWith('gemini:') ? '复用 Nano Banana 服务账号' : '使用自己的 OpenAI API Key'
}))

export default function SettingsPage() {
    const { t } = useI18n()
    const [configs, setConfigs] = useState<Record<string, ServiceConfig>>({})
    const [saving, setSaving] = useState<string | null>(null)
    const [saved, setSaved] = useState<string | null>(null)
    const [imageProvider, setImageProvider] = useState('banana')
    const [imageQuality, setImageQuality] = useState<ImageQuality>('standard')
    const [savingImg, setSavingImg] = useState(false)
    const [savingImgQuality, setSavingImgQuality] = useState(false)
    const [videoLanguage, setVideoLanguage] = useState<VideoLanguage>('zh')
    const [savingVideoLanguage, setSavingVideoLanguage] = useState(false)
    const [safetyDiagnostics, setSafetyDiagnostics] = useState(false)
    const [savingSafetyDiagnostics, setSavingSafetyDiagnostics] = useState(false)

    useEffect(() => {
        clientFetch('/api/settings')
            .then(async response => {
                const json = await readApiJson(response)
                if (!response.ok || !json.success) throw new Error(json.error ?? '生成设置加载失败')
                return json
            })
            .then(json => {
                const map: Record<string, ServiceConfig> = {}
                for (const c of json.data ?? []) {
                    const textModel = ['openai', 'chapter_model', 'script_model'].includes(c.provider) && c.modelName ? normalizeLegacyHiModelsModelId(c.modelName) : c.modelName
                    map[c.provider] = { ...c, modelName: textModel }
                }
                setConfigs(map)
                if (map['image']?.modelName) {
                    setImageProvider(map['image'].modelName)
                }
                setImageQuality(normalizeImageQuality(map['image_quality']?.modelName))
                setVideoLanguage(normalizeVideoLanguage(map['video_language']?.modelName))
                setSafetyDiagnostics(map['safety_diagnostics']?.modelName === 'enabled')
            })
            .catch(error => pushToast('error', error instanceof Error ? error.message : '生成设置加载失败'))
    }, [])

    async function persistSetting(provider: string, modelName: string, fallbackMessage: string): Promise<ServiceConfig> {
        const response = await clientFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, modelName })
        })
        const json = await readApiJson(response)
        if (!response.ok || !json.success) throw new Error(json.error ?? fallbackMessage)
        const savedConfig = json.data as ServiceConfig | undefined
        if (savedConfig?.provider !== provider || savedConfig.modelName !== modelName) throw new Error(`${fallbackMessage}：服务端未确认新设置`)
        setConfigs(previous => ({ ...previous, [provider]: savedConfig }))
        return savedConfig
    }

    async function saveImageProvider() {
        setSavingImg(true)
        try {
            await persistSetting('image', imageProvider, '图像模型保存失败')
            setSaved('image')
            setTimeout(() => setSaved(null), 2000)
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '图像模型保存失败')
        } finally {
            setSavingImg(false)
        }
    }

    async function saveImageQuality() {
        setSavingImgQuality(true)
        try {
            await persistSetting('image_quality', imageQuality, '图片清晰度保存失败')
            setSaved('image_quality')
            setTimeout(() => setSaved(null), 2000)
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '图片清晰度保存失败')
        } finally {
            setSavingImgQuality(false)
        }
    }

    async function saveVideoLanguage() {
        setSavingVideoLanguage(true)
        try {
            await persistSetting('video_language', videoLanguage, '视频原声语言保存失败')
            setSaved('video_language')
            setTimeout(() => setSaved(null), 2000)
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '视频原声语言保存失败')
        } finally {
            setSavingVideoLanguage(false)
        }
    }

    async function saveSafetyDiagnostics(next = safetyDiagnostics) {
        const previous = safetyDiagnostics
        setSavingSafetyDiagnostics(true)
        setSafetyDiagnostics(next)
        try {
            await persistSetting('safety_diagnostics', next ? 'enabled' : 'disabled', '敏感词调试设置保存失败')
            setSaved('safety_diagnostics')
            setTimeout(() => setSaved(null), 2000)
        } catch (error) {
            setSafetyDiagnostics(previous)
            pushToast('error', error instanceof Error ? error.message : '敏感词调试设置保存失败')
        } finally {
            setSavingSafetyDiagnostics(false)
        }
    }

    async function saveOpenaiModel(modelName: string) {
        setSaving('openai-preset')
        try {
            await persistSetting('openai', modelName, '文本模型保存失败')
            setSaved('openai-preset')
            setTimeout(() => setSaved(null), 2000)
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '文本模型保存失败')
        } finally {
            setSaving(null)
        }
    }

    return (
        <div className="app-page flex min-h-screen flex-col">
            <SiteHeader contentClassName="flex items-center gap-4">
                <HomeLogoLink />
                <Link
                    href="/projects"
                    className="text-gray-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
                </Link>
                <div className="flex items-center gap-2">
                    <Settings className="w-5 h-5 text-purple-400" />
                    <h1 className="text-white font-bold text-xl">{t('生成设置')}</h1>
                </div>
            </SiteHeader>

            <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-6 py-8">
                <p className="text-gray-400 text-sm">{t('选择生成模型、图片清晰度和视频原声语言。')}</p>
                <p className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 text-sm leading-6 text-gray-300">
                    {t('请在本机 .env 填写所选供应商的个人 Token / API Key，并重启应用。项目不提供共享密钥；未配置的供应商无法生成。')}
                </p>

                {/* 全局视频原声语言 */}
                <div className="rounded-xl border border-blue-700/30 bg-gradient-to-br from-blue-900/20 to-cyan-900/10 p-5">
                    <div className="mb-4 flex items-start gap-3">
                        <span className="rounded-lg bg-blue-500/10 p-2 text-blue-300">
                            <Languages className="h-5 w-5" />
                        </span>
                        <div>
                            <h2 className="font-semibold text-white">{t('视频原声语言')}</h2>
                            <p className="mt-1 text-xs leading-5 text-gray-400">{t('所有项目共用。控制后续支持原生音频的视频模型所生成的对白与口型语言。已有视频不会自动重新生成。')}</p>
                        </div>
                    </div>
                    <div
                        className="grid grid-cols-2 gap-2"
                        role="radiogroup"
                        aria-label={t('视频原声语言')}>
                        {(
                            [
                                { value: 'zh', label: '中文', desc: '普通话原声' },
                                { value: 'en', label: '英文', desc: '英语原声' }
                            ] as const
                        ).map(option => (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={videoLanguage === option.value}
                                onClick={() => setVideoLanguage(option.value)}
                                className={`rounded-lg border px-4 py-3 text-start transition-colors ${
                                    videoLanguage === option.value ? 'border-blue-400 bg-blue-500/15 text-white' : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600'
                                }`}>
                                <span className="block text-sm font-medium">{t(option.label)}</span>
                                <span className="mt-0.5 block text-[11px] text-gray-500">{t(option.desc)}</span>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={saveVideoLanguage}
                        disabled={savingVideoLanguage}
                        className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
                        <Save className="h-4 w-4" />
                        {t(saved === 'video_language' ? '已保存 ✓' : savingVideoLanguage ? '保存中...' : '保存原声语言')}
                    </button>
                </div>

                {/* 图像模型选择器 */}
                <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-700/30 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h2 className="text-white font-semibold">{t('图像生成模型')}</h2>
                            <p className="text-xs text-gray-400 mt-0.5">{t('用于生成角色图、场景图、项目风格图和首尾帧。所有项目共用此设置。')}</p>
                        </div>
                        {configs['image'] && <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">{t('已配置')}</span>}
                    </div>
                    <div className="space-y-3">
                        {GENERATION_MODEL_SOURCES.map(source => (
                            <div key={source}>
                                <div className="mb-1.5 px-1 text-[10px] font-medium tracking-wider text-gray-500">{t(GENERATION_MODEL_SOURCE_LABELS[source])}</div>
                                <div className="space-y-2">
                                    {IMAGE_PROVIDERS.filter(provider => generationModelSource(provider.value) === source).map(p => (
                                        <label
                                            key={p.value}
                                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-colors ${
                                                imageProvider === p.value ? 'bg-purple-500/10 border-purple-500' : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                                            }`}>
                                            <input
                                                type="radio"
                                                name="imageProvider"
                                                value={p.value}
                                                checked={imageProvider === p.value}
                                                onChange={e => setImageProvider(e.target.value)}
                                                className="accent-purple-500"
                                            />
                                            <div>
                                                <div className="text-white text-sm font-medium">{p.label}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 border-t border-gray-800 pt-4">
                        <div className="mb-2 flex items-center justify-between">
                            <div>
                                <div className="text-white text-sm font-medium">{t('默认图片清晰度')}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{t('用于角色图、场景图、项目风格图和分镜插图。超清会更慢。')}</div>
                            </div>
                            {configs['image_quality'] && <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">{t('已配置')}</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {IMAGE_QUALITY_OPTIONS.map(option => (
                                <label
                                    key={option.value}
                                    title={t(option.desc)}
                                    className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm transition-colors ${
                                        imageQuality === option.value ? 'border-cyan-500 bg-cyan-500/10 text-white' : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600'
                                    }`}>
                                    <input
                                        type="radio"
                                        name="imageQuality"
                                        value={option.value}
                                        checked={imageQuality === option.value}
                                        onChange={e => setImageQuality(e.target.value as ImageQuality)}
                                        className="sr-only"
                                    />
                                    {t(option.label)}
                                </label>
                            ))}
                        </div>
                        <button
                            onClick={saveImageQuality}
                            disabled={savingImgQuality}
                            className="mt-3 flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                            <Save className="w-4 h-4" />
                            {t(saved === 'image_quality' ? '已保存 ✓' : savingImgQuality ? '保存中...' : '保存清晰度')}
                        </button>
                    </div>
                    <button
                        onClick={saveImageProvider}
                        disabled={savingImg}
                        className="mt-4 flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                        <Save className="w-4 h-4" />
                        {t(saved === 'image' ? '已保存 ✓' : savingImg ? '保存中...' : '保存图像模型')}
                    </button>
                </div>

                {/* 敏感词/安全拦截调试 */}
                <div className="bg-gradient-to-br from-amber-900/20 to-yellow-900/20 border border-amber-700/30 rounded-xl p-5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-white font-semibold">{t('敏感词调试信息')}</h2>
                            <p className="text-xs text-gray-400 mt-0.5">{t('开启后，Gemini / Nano Banana 被拦截或无图返回时，会在错误里显示 blockReason、finishReason 和 safetyRatings。')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => saveSafetyDiagnostics(!safetyDiagnostics)}
                            disabled={savingSafetyDiagnostics}
                            className={`relative h-7 w-12 flex-shrink-0 rounded-full border transition-colors ${
                                safetyDiagnostics ? 'border-amber-400 bg-amber-500' : 'border-gray-700 bg-gray-800'
                            } disabled:opacity-60`}
                            aria-pressed={safetyDiagnostics}>
                            <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${safetyDiagnostics ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`}
                            />
                        </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs">
                        <span className={safetyDiagnostics ? 'text-amber-300' : 'text-gray-500'}>{t(safetyDiagnostics ? '已开启' : '已关闭')}</span>
                        {saved === 'safety_diagnostics' && <span className="text-green-400">{t('已保存 ✓')}</span>}
                        {savingSafetyDiagnostics && <span className="text-gray-500">{t('保存中...')}</span>}
                    </div>
                </div>

                {/* 文本模型快速切换 */}
                <div className="bg-gradient-to-br from-blue-900/20 to-teal-900/20 border border-blue-700/30 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h2 className="text-white font-semibold">{t('文本生成模型')}</h2>
                            <p className="text-xs text-gray-400 mt-0.5">{t('用于生成小说、大纲、章节正文、剧本、分镜、角色提取等所有文本任务')}</p>
                        </div>
                        {configs['openai']?.modelName && (
                            <span className="flex items-center gap-1.5 rounded bg-blue-400/10 px-2 py-0.5 text-xs text-blue-300 font-mono">
                                <ModelSourceBadge model={configs['openai'].modelName} />
                                {modelDisplayName(configs['openai'].modelName)}
                            </span>
                        )}
                    </div>
                    <div className="space-y-3">
                        {GENERATION_MODEL_SOURCES.map(source => (
                            <div key={source}>
                                <div className="mb-1.5 px-1 text-[10px] font-medium tracking-wider text-gray-500">{t(GENERATION_MODEL_SOURCE_LABELS[source])}</div>
                                <div className="space-y-2">
                                    {OPENAI_MODEL_PRESETS.filter(model => model.source === source).map(m => {
                                        const isActive = configs['openai']?.modelName === m.value
                                        return (
                                            <button
                                                key={m.value}
                                                onClick={() => saveOpenaiModel(m.value)}
                                                disabled={saving === 'openai-preset'}
                                                className={`w-full text-start flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                                    isActive ? 'bg-blue-500/10 border-blue-500' : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                                                }`}>
                                                <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-blue-500' : 'border border-gray-600'}`}>
                                                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-white text-sm font-medium">{m.label}</div>
                                                </div>
                                                {isActive && saved === 'openai-preset' && <span className="text-xs text-green-400">{t('已保存 ✓')}</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-3">{t('切换模型后，后续生成任务会使用新模型。')}</p>
                </div>
            </main>
            <SiteFooter />
        </div>
    )
}
