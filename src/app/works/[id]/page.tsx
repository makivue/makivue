import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { isLocale } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import WorkDetail from './WorkDetail'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const value = (await headers()).get('x-app-locale')
    const locale = isLocale(value) ? value : 'en'
    return buildPublicMetadata(locale, `/works/${(await params).id}`, { title: translateMessage(locale, '剧集详情'), description: translateMessage(locale, '发现创作者的故事，观看原创 AI 短剧。') })
}

export default async function WorkPage({ params }: Props) {
    return (
        <WorkDetail
            key={(await params).id}
            id={(await params).id}
        />
    )
}
