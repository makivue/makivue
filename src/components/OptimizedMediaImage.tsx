'use client'

import Image, { type ImageProps } from 'next/image'

type Props = Omit<ImageProps, 'loader' | 'src' | 'unoptimized'> & { src: string }

/** Display locally saved originals without remote image transformations. */
export default function OptimizedMediaImage({ src, alt, ...props }: Props) {
    return (
        <Image
            {...props}
            data-i18n-skip
            src={src}
            alt={alt}
            unoptimized
            decoding={props.decoding ?? 'async'}
        />
    )
}
