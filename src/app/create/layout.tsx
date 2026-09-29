import type { Metadata } from 'next'
import { localizedPrivateMetadata } from '@/i18n/metadata'

export function generateMetadata(): Promise<Metadata> {
    return localizedPrivateMetadata('AI 创作台', '通过文字描述和参考图快速生成图片与视频')
}

export default function CreateLayout({ children }: { children: React.ReactNode }) {
    return children
}
