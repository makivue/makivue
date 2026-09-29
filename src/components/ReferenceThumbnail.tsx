import OptimizedMediaImage from '@/components/OptimizedMediaImage'

interface Props {
    src: string
    alt: string
    sizes: string
    className?: string
}

export default function ReferenceThumbnail({ src, alt, sizes, className }: Props) {
    return (
        <OptimizedMediaImage
            src={src}
            alt={alt}
            width={640}
            height={360}
            sizes={sizes}
            quality={75}
            loading="lazy"
            className={className}
        />
    )
}
