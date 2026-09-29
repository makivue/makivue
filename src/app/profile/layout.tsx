import type { Metadata } from 'next'
import { localizedPrivateMetadata } from '@/i18n/metadata'

export function generateMetadata(): Promise<Metadata> {
    return localizedPrivateMetadata('个人中心', '查看个人资料与账户信息')
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
    return children
}
