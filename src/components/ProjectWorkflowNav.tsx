'use client'

import { Fragment, type ReactNode } from 'react'
import { BarChart3, BookOpen, Film, Globe, MapPin, Users } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { getProjectContentWorkflow } from '@/lib/project-content-workflow'

const SECTIONS = [
    { key: 'novel', label: '小说', icon: BookOpen },
    { key: 'characters', label: '角色', icon: Users },
    { key: 'scenes', label: '场景', icon: MapPin },
    { key: 'episodes', label: '集数', icon: Film },
    { key: 'publication', label: '发布作品', icon: Globe }
] as const

type Section = (typeof SECTIONS)[number]['key']
type WorkspaceSection = Exclude<Section, 'publication'> | 'insights'

function sectionHref(projectId: string, section: Section | 'insights') {
    if (section === 'characters' || section === 'scenes' || section === 'publication') return `/projects/${projectId}/${section}`
    if (section === 'novel') return `/projects/${projectId}?tab=novel&stage=setup`
    return `/projects/${projectId}?tab=${section}`
}

export default function ProjectWorkflowNav({
    project,
    current,
    collapsed,
    onNavigate,
    children
}: {
    project: {
        id: string
        novelSetup?: string | null
        novelStage?: string | null
        episodes?: readonly { status?: string | null; _count?: { storyboards: number } }[]
        characters?: readonly unknown[]
        scenes?: readonly unknown[]
    }
    current: Section | 'insights'
    collapsed: boolean
    onNavigate?: (section: WorkspaceSection) => void
    children?: ReactNode
}) {
    const { t } = useI18n()
    const workflow = getProjectContentWorkflow(project)
    const spacing = collapsed ? 'h-10 justify-center px-0' : 'gap-3 px-3 py-2.5'
    const linkClass = (active: boolean) =>
        `flex w-full items-center rounded-md text-[13px] transition-colors ${spacing} ${active ? 'bg-gray-800/70 text-white' : 'text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'}`

    return (
        <nav
            aria-label={t('短剧创作流程')}
            className="novel-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {SECTIONS.map(({ key, label: defaultLabel, icon: Icon }) => {
                const label = key === 'novel' && workflow.importedScript ? '剧本' : defaultLabel
                return (
                    <Fragment key={key}>
                        <Link
                            href={key === 'novel' ? `/projects/${project.id}?tab=novel&stage=${workflow.firstStage}` : sectionHref(project.id, key)}
                            prefetch={false}
                            onNavigate={event => {
                                if (key === 'publication' || !onNavigate) return
                                event.preventDefault()
                                onNavigate(key)
                            }}
                            aria-current={current === key ? 'page' : undefined}
                            title={t(label)}
                            className={linkClass(current === key)}>
                            <Icon
                                className="h-4 w-4 shrink-0"
                                aria-hidden="true"
                            />
                            {!collapsed && (
                                <>
                                    <span className="min-w-0 flex-1 truncate text-start font-medium">{t(label)}</span>
                                    {key !== 'novel' && key !== 'publication' && <span className="text-[10px] text-gray-500">{project[key]?.length ?? 0}</span>}
                                </>
                            )}
                        </Link>
                        {key === 'novel' && current === key && !collapsed && children}
                    </Fragment>
                )
            })}
            <div className="mt-3 border-t border-gray-800 pt-3">
                <Link
                    href={sectionHref(project.id, 'insights')}
                    prefetch={false}
                    onNavigate={event => {
                        if (!onNavigate) return
                        event.preventDefault()
                        onNavigate('insights')
                    }}
                    aria-current={current === 'insights' ? 'page' : undefined}
                    title={t('生产数据与质检')}
                    className={linkClass(current === 'insights')}>
                    <BarChart3
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                    />
                    {!collapsed && <span className="min-w-0 flex-1 truncate text-start">{t('生产数据与质检')}</span>}
                </Link>
            </div>
        </nav>
    )
}
