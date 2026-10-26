import { Suspense } from 'react'
import type { Metadata } from 'next'
import StyleLibrary from './StyleLibrary'

export const metadata: Metadata = { title: '风格库', robots: { index: false, follow: false } }

export default function Page() {
    return (
        <Suspense fallback={null}>
            <StyleLibrary />
        </Suspense>
    )
}
