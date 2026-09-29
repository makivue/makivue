'use client'

import BrandLogo from '@/components/BrandLogo'
import LegalLinks from '@/components/LegalLinks'
import { useI18n } from '@/i18n/I18nProvider'
import Link from '@/i18n/navigation'
import { SITE_NAME } from '@/lib/seo'

export default function SiteFooter() {
    const { t } = useI18n()

    return (
        <footer className="home-footer relative z-10 w-full overflow-hidden border-t border-white/[0.08] bg-[#080910]/80 px-4 pb-5 pt-8 text-white print:hidden sm:px-6">
            <div className="home-footer-glow pointer-events-none absolute -top-32 left-1/2 h-64 w-[min(760px,90vw)] -translate-x-1/2 rounded-full bg-violet-600/[0.08] blur-[100px]" />
            <div className="relative w-full">
                <div className="home-footer-grid grid grid-cols-2 gap-x-8 gap-y-6 border-b border-white/[0.08] pb-6 md:grid-cols-[minmax(0,1.5fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)] lg:gap-x-10">
                    <div className="col-span-2 max-w-sm md:col-span-1">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-3 rounded-2xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-400">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                                <BrandLogo size={30} />
                            </span>
                            <span
                                dir="ltr"
                                translate="no"
                                className="home-footer-title text-lg font-semibold tracking-tight text-white">
                                {SITE_NAME}
                            </span>
                        </Link>
                        <p className="home-footer-copy mt-3 text-sm leading-6 text-slate-400">{t('从一个故事想法开始，按自己的节奏完成剧本、角色、分镜与视频。')}</p>
                    </div>

                    <nav
                        aria-label={t('AI 创作工具')}
                        className="flex flex-col gap-2 text-sm">
                        <span className="home-footer-label mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('产品')}</span>
                        <Link
                            href="/features/ai-short-drama-generator"
                            className="home-footer-link w-fit text-slate-300 transition hover:text-violet-200">
                            {t('AI 短剧生成器')}
                        </Link>
                        <Link
                            href="/features/ai-storyboard-generator"
                            className="home-footer-link w-fit text-slate-300 transition hover:text-violet-200">
                            {t('AI 分镜生成器')}
                        </Link>
                        <Link
                            href="/features/ai-video-generator"
                            className="home-footer-link w-fit text-slate-300 transition hover:text-violet-200">
                            {t('AI 视频生成器')}
                        </Link>
                    </nav>

                    <nav
                        aria-label={t('更多资源')}
                        className="flex flex-col gap-2 text-sm">
                        <span className="home-footer-label mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('资源')}</span>
                        <Link
                            href="/works"
                            className="home-footer-link w-fit text-slate-300 transition hover:text-violet-200">
                            {t('剧集')}
                        </Link>
                        <Link
                            href="/settings"
                            className="home-footer-link w-fit text-slate-300 transition hover:text-violet-200">
                            {t('模型设置')}
                        </Link>
                        <Link
                            href="/faq"
                            className="home-footer-link w-fit text-slate-300 transition hover:text-violet-200">
                            {t('常见问题')}
                        </Link>
                    </nav>
                </div>

                <div className="flex flex-col gap-4 pt-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
                    <p className="home-footer-meta text-xs leading-5 text-slate-600">{t('© Local Drama Studio · AI 故事视频工作室')}</p>
                    <div className="min-w-0 lg:ms-auto">
                        <LegalLinks className="lg:flex-row lg:flex-wrap lg:justify-end lg:gap-x-6" />
                    </div>
                </div>
            </div>
        </footer>
    )
}
