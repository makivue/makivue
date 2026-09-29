import Image from 'next/image'
import logo from '../../public/brand/logo.png'

export default function BrandLogo({ size = 36 }: { size?: number }) {
    return (
        <Image
            src={logo}
            alt=""
            width={size}
            height={size}
            className="shrink-0 object-contain"
        />
    )
}
