import type { ReactNode } from 'react'
import type { Locale } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'

export default function SignupBonus({ locale, children, compact = false }: { locale: Locale; children?: ReactNode; compact?: boolean }) {
    const t = (source: string) => translateMessage(locale, source)

    return (
        <div
            data-i18n-skip
            className={`relative isolate overflow-hidden rounded-3xl border border-violet-200/20 bg-[#151020] text-start ${compact ? 'p-5' : 'p-6 shadow-[0_24px_80px_-30px_rgba(139,92,246,0.35)] sm:p-7'}`}>
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-violet-200/70 to-transparent"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -start-24 -top-32 -z-10 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl"
            />
            <div className={compact ? 'flex flex-wrap items-center gap-x-5 gap-y-3' : 'flex flex-col items-center gap-5 sm:flex-row sm:gap-7'}>
                <div className={compact ? 'shrink-0' : 'w-full shrink-0 border-b border-dashed border-violet-200/20 pb-5 text-center sm:w-56 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-7'}>
                    <p className="text-xs font-medium tracking-wider text-violet-200">{t('新用户创作礼')}</p>
                    <p className={`mt-2 font-bold leading-none tracking-[-0.06em] text-violet-100 ${compact ? 'text-5xl' : 'text-7xl'}`}>
                        <bdi>{new Intl.NumberFormat(locale).format(3000)}</bdi>
                    </p>
                    <p className="mt-2 text-xs text-violet-200/80">{t('创作金币')}</p>
                </div>
                <div className={compact ? 'min-w-48 flex-1' : 'min-w-0 flex-1'}>
                    <p className={`font-semibold tracking-tight text-white ${compact ? 'text-base' : 'text-xl sm:text-[22px]'}`}>{t('让第一个故事，免费起步。')}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{t('注册即领，可用于 AI 剧本、图片、分镜与视频生成。')}</p>
                    {children ? <div className="mt-5">{children}</div> : null}
                    <p className="mt-3 text-xs leading-5 text-slate-400">{t('每个新账号赠送一次，自动入账。')}</p>
                </div>
            </div>
        </div>
    )
}
