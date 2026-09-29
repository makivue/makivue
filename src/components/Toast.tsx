'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'

export type ToastType = 'success' | 'error' | 'info'
export interface ToastItem {
    id: number
    type: ToastType
    text: string
    createdAt: number
}

// 极简全局 store，避免引入第三方依赖。SSR 侧不会被访问（组件是 client-only）。
type Listener = (items: ToastItem[]) => void
const listeners = new Set<Listener>()
let items: ToastItem[] = []
let counter = 1

// 相同 (type, text) 的短时间去重，避免同一次调用被多处 setAiMsg 触发出重复 toast。
const DEDUPE_WINDOW_MS = 500

function emit() {
    for (const l of listeners) l(items)
}

export function pushToast(type: ToastType, text: string) {
    if (!text) return
    const now = Date.now()
    const dup = items.find(i => i.type === type && i.text === text && (type === 'error' || now - i.createdAt < DEDUPE_WINDOW_MS))
    if (dup) return
    const id = counter++
    items = [...items, { id, type, text, createdAt: now }]
    emit()
    // success/info 自动消失；error 手动关（用户可能想复制内容）
    if (type !== 'error') {
        setTimeout(() => dismissToast(id), 3000)
    }
}

function dismissToast(id: number) {
    items = items.filter(i => i.id !== id)
    emit()
}

const TYPE_STYLE: Record<ToastType, { border: string; bg: string; icon: string; Icon: typeof CheckCircle2 }> = {
    success: {
        border: 'border-emerald-500/40',
        bg: 'bg-emerald-500/10',
        icon: 'text-emerald-300',
        Icon: CheckCircle2
    },
    error: {
        border: 'border-red-500/40',
        bg: 'bg-red-500/10',
        icon: 'text-red-300',
        Icon: AlertTriangle
    },
    info: {
        border: 'border-purple-500/40',
        bg: 'bg-purple-500/10',
        icon: 'text-purple-200',
        Icon: Info
    }
}

export default function ToastHost() {
    const { t } = useI18n()
    const [list, setList] = useState<ToastItem[]>(items)
    useEffect(() => {
        const listener: Listener = next => setList(next)
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }, [])

    if (list.length === 0) return null

    return (
        <div
            data-i18n-skip
            className="fixed end-4 top-4 z-[100] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 pointer-events-none">
            {list.map(item => {
                const style = TYPE_STYLE[item.type]
                const Icon = style.Icon
                return (
                    <div
                        key={item.id}
                        role="status"
                        data-toast-type={item.type}
                        className={`home-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border ${style.border} ${style.bg} backdrop-blur-sm px-3.5 py-3 text-sm shadow-lg shadow-black/30 animate-toast-in`}>
                        <Icon className={`home-toast-icon h-4.5 w-4.5 shrink-0 mt-0.5 ${style.icon}`} />
                        <div className="home-toast-copy flex-1 min-w-0 whitespace-pre-wrap break-words leading-relaxed text-gray-100">{t(item.text)}</div>
                        <button
                            type="button"
                            onClick={() => dismissToast(item.id)}
                            aria-label={t('关闭')}
                            className="home-toast-close mt-0.5 rounded-md p-1 text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
