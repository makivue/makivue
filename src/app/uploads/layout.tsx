import { localizedPrivateMetadata } from '@/i18n/metadata'

export function generateMetadata() {
    return localizedPrivateMetadata('我的上传', '管理你上传的影视作品')
}

export default function UploadsLayout({ children }: { children: React.ReactNode }) {
    return children
}
