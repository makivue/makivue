'use client'

import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search, Sparkles } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { SITE_NAME } from '@/lib/seo'
import './works.css'

export default function WorksShell({ children, showSearch = true }: { children: ReactNode; showSearch?: boolean }) {
    const { t, href } = useI18n()
    const params = useSearchParams()
    return (
        <div
            className="studio-theme works-shell"
            data-i18n-skip>
            <SiteHeader
                sticky
                className="works-header"
                contentClassName="flex flex-wrap items-center gap-4">
                <Link
                    href="/"
                    className="works-brand"
                    title={`${SITE_NAME} · ${t('返回首页')}`}
                    aria-label={`${SITE_NAME} · ${t('返回首页')}`}>
                    <BrandLogo size={28} />
                    <span translate="no">{SITE_NAME}</span>
                </Link>
                {showSearch && (
                    <form
                        action={href('/works')}
                        className="works-search"
                        role="search">
                        <input
                            key={params.get('q') ?? ''}
                            name="q"
                            type="search"
                            defaultValue={params.get('q') ?? ''}
                            maxLength={100}
                            placeholder={t('搜索剧集')}
                            aria-label={t('搜索剧集')}
                        />
                        {params.get('genre') && (
                            <input
                                type="hidden"
                                name="genre"
                                value={params.get('genre')!}
                            />
                        )}
                        <button
                            type="submit"
                            className="works-search-submit"
                            aria-label={t('搜索剧集')}>
                            <Search
                                size={17}
                                aria-hidden
                            />
                        </button>
                    </form>
                )}
                <Link
                    href="/"
                    className="works-create"
                    title={t('开始创作')}>
                    <Sparkles size={16} />
                    {t('开始创作')}
                </Link>
            </SiteHeader>
            <div className="works-body">
                {children}
                <SiteFooter />
            </div>
        </div>
    )
}
