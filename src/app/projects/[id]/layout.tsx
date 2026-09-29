'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { stripLocale } from '@/i18n/config'

const ProjectWorkspace = dynamic(() => import('./ProjectWorkspace').then(module => module.ProjectWorkspace))

type WorkspaceRouteTab = 'novel' | 'characters' | 'scenes'

function workspaceTabFromPathname(pathname: string): WorkspaceRouteTab | null {
    const segments = stripLocale(pathname).split('/').filter(Boolean)
    if (segments[0] !== 'projects' || segments.length < 2) return null
    if (segments.length === 2) return 'novel'
    if (segments.length !== 3) return null
    if (segments[2] === 'characters' || segments[2] === 'scenes') return segments[2]
    return null
}

export default function ProjectLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const workspaceTab = workspaceTabFromPathname(pathname)

    // Keep the large project workspace mounted while its character and scene
    // URLs change. Other descendants, such as an episode editor, render normally.
    if (workspaceTab) return <ProjectWorkspace initialTab={workspaceTab} />
    return children
}
