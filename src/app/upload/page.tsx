import { Suspense } from 'react'
import { localizedPrivateMetadata } from '@/i18n/metadata'
import UploadStudio from './UploadStudio'

export function generateMetadata() {
    return localizedPrivateMetadata('上传影视', '从第一张封面到最后一集，给你的作品一个完整的舞台。')
}

export default function UploadPage() {
    return (
        <Suspense>
            <UploadStudio />
        </Suspense>
    )
}
