'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Check, ChevronDown } from 'lucide-react'
import { clientFetch } from '@/lib/client-fetch'
import { pushToast } from '@/components/Toast'
import { TEXT_MODEL_OPTIONS, TEXT_MODEL_SOURCE_LABELS, type TextModelOption } from '@/lib/text-model-options'
import { modelDisplayName, modelDisplayNameWithSource } from '@/lib/model-display'
import { normalizeLegacyHiModelsModelId } from '@/lib/himodels-models'
import { useI18n } from '@/i18n/I18nProvider'

const SOURCES: TextModelOption['source'][] = ['direct', 'himodels']

export default function ModelSwitcher({
    providerKey = 'openai',
    title = '当前文本模型',
    prefix,
    defaultModel,
    widthClass = 'w-full'
}: {
    providerKey?: string
    title?: string
    prefix?: string
    defaultModel?: string
    widthClass?: string
}) {
    const { t } = useI18n()
    const [current, setCurrent] = useState<string | null>(null)
    const [saving, setSaving] = useState<string | null>(null)
    const [open, setOpen] = useState(false)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        clientFetch('/api/settings')
            .then(r => r.json())
            .then(j => {
                const config = (j.data ?? []).find((c: { provider: string; modelName?: string }) => c.provider === providerKey)
                const configuredModel = config?.modelName ?? defaultModel
                setCurrent(configuredModel ? normalizeLegacyHiModelsModelId(configuredModel) : null)
                setLoaded(true)
            })
            .catch(() => setLoaded(true))
    }, [providerKey, defaultModel])

    async function switchTo(modelName: string) {
        if (modelName === current) {
            setOpen(false)
            return
        }
        setSaving(modelName)
        try {
            const response = await clientFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerKey, modelName })
            })
            const payload = await response.json().catch(() => null)
            if (!response.ok || !payload?.success) throw new Error(payload?.error ?? `模型切换失败（HTTP ${response.status}）`)

            setCurrent(modelName)
            pushToast('success', `模型已切换为 ${modelDisplayNameWithSource(modelName, t)}`)
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '模型切换失败，请重试')
        } finally {
            setSaving(null)
            setOpen(false)
        }
    }

    if (!loaded) return null

    const currentPreset = TEXT_MODEL_OPTIONS.find(p => p.value === current)
    const label = modelDisplayName(currentPreset?.label ?? current ?? '未配置')

    return (
        <div className={`relative ${widthClass}`}>
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-800/60 hover:bg-gray-800 border border-gray-700 text-[12px] text-gray-300 transition-colors"
                title={`${title}：${modelDisplayNameWithSource(current ?? '未配置', t)}`}>
                <Sparkles className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                {prefix && <span className="text-gray-500 text-[10px]">{prefix}</span>}
                <span className="flex-1 text-start text-white truncate">{label}</span>
                <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <>
                    <div
                        className="fixed inset-0 z-30"
                        onClick={() => setOpen(false)}
                    />
                    <div className="absolute inset-x-0 top-full mt-1 z-40 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                        {SOURCES.map(source => {
                            const items = TEXT_MODEL_OPTIONS.filter(p => p.source === source)
                            if (items.length === 0) return null
                            return (
                                <div key={source}>
                                    <div className="px-3 py-1 text-[9px] tracking-wider text-gray-600 bg-gray-950/50 border-b border-gray-800">{t(TEXT_MODEL_SOURCE_LABELS[source])}</div>
                                    {items.map(p => {
                                        const isActive = p.value === current
                                        const isBusy = saving === p.value
                                        return (
                                            <button
                                                key={p.value}
                                                onClick={() => switchTo(p.value)}
                                                disabled={isBusy}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-start transition-colors ${
                                                    isActive ? 'bg-blue-500/10 text-blue-300' : 'text-gray-300 hover:bg-gray-800'
                                                }`}>
                                                <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                                                <span className="flex-1">
                                                    <span className="text-white font-medium">{modelDisplayName(p.label)}</span>
                                                </span>
                                                {isActive && <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                                                {isBusy && <span className="text-[10px] text-gray-500">切换中</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>
                </>
            )}
        </div>
    )
}
