import Link from 'next/link'
import { localizePath } from '@/i18n/config'
import { toolNavigation } from '@/i18n/creation-tool-navigation'
import type { ToolLocale, ToolSlug } from '@/i18n/creation-tool-config'

const groups: Record<'image' | 'video' | 'all', readonly ToolSlug[]> = {
    image: ['ai-image-generator', 'text-to-image', 'image-to-image'],
    video: ['text-to-video', 'image-to-video'],
    all: ['ai-image-generator', 'text-to-image', 'image-to-image', 'text-to-video', 'image-to-video']
}

export default function CreationToolLinks({ locale, kind = 'all' }: { locale: ToolLocale; kind?: keyof typeof groups }) {
    const copy = toolNavigation[locale]
    return (
        <nav
            aria-label={copy.related}
            className="mt-6 flex flex-wrap gap-x-5 gap-y-3 text-sm leading-6 text-violet-200">
            {groups[kind].map(slug => (
                <Link
                    key={slug}
                    href={localizePath(`/tools/${slug}`, locale)}
                    title={copy.tools[slug]}
                    className="underline-offset-4 hover:underline">
                    {copy.tools[slug]}
                </Link>
            ))}
        </nav>
    )
}
