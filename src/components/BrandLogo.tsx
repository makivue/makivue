import Image from 'next/image'
import { SITE_NAME } from '@/lib/seo'
import logo from '../../public/brand/logo.png'

export default function BrandLogo({ size = 36 }: { size?: number }) {
    return (
        <Image
            src={logo}
            alt={SITE_NAME}
            width={size}
            height={size}
            className="shrink-0 object-contain"
        />
    )
}
