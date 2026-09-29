'use client'

import { Clapperboard, Film, ImagePlus } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'

const modes = [
    { key: 'drama', label: 'AI 短剧', Icon: Clapperboard },
    { key: 'video', label: 'AI 视频', Icon: Film },
    { key: 'image', label: 'AI 图片', Icon: ImagePlus }
] as const

export default function CreationModeNav({ mode }: { mode: (typeof modes)[number]['key'] }) {
    const { t } = useI18n()
    return (
        <nav
            aria-label={t('AI 创作台')}
            className="order-3 col-span-2 mt-2 flex justify-center gap-1 lg:order-2 lg:col-span-1 lg:mt-0">
            {modes.map(({ key, label, Icon }) => (
                <Link
                    key={key}
                    href={key === 'drama' ? '/' : `/ai${key}`}

                    aria-current={mode === key ? 'page' : undefined}
                    className={`relative flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-400 sm:px-5 lg:flex-none ${mode === key ? 'text-violet-200 after:bg-violet-400' : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-200'}`}>
                    <Icon
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0"
                    />
                    {t(label)}
                </Link>
            ))}
        </nav>
    )
}
