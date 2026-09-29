import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import WorksShell from '@/components/WorksShell'
import { isLocale } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'
import { buildPublicMetadata } from '@/lib/seo-metadata'

export async function generateMetadata(): Promise<Metadata> {
    const value = (await headers()).get('x-app-locale')
    const locale = isLocale(value) ? value : 'en'
    return buildPublicMetadata(locale, '/works', { title: translateMessage(locale, '剧集'), description: translateMessage(locale, '发现创作者的故事，观看原创 AI 短剧。') })
}

export default function WorksLayout({ children }: { children: React.ReactNode }) {
    return (
        <Suspense>
            <WorksShell>{children}</WorksShell>
        </Suspense>
    )
}
