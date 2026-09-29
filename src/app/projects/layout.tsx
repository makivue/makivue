import { localizedPrivateMetadata } from '@/i18n/metadata'

export function generateMetadata() {
    return localizedPrivateMetadata('我的项目', '管理你的 AI 短剧项目')
}

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
    return children
}
