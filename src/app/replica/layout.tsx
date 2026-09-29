import type { Metadata } from 'next'
import { localizedPrivateMetadata } from '@/i18n/metadata'

export function generateMetadata(): Promise<Metadata> {
    return localizedPrivateMetadata('同款视频生成', '分析参考视频的内容结构，生成同类型脚本、配音和视频成片')
}

export default function ReplicaLayout({ children }: { children: React.ReactNode }) {
    return children
}
