'use client'

import { useEffect, useRef } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import GlobalPreferences from '@/components/GlobalPreferences'

const STAGES = [
    { key: 'outline', label: '故事大纲' },
    { key: 'script', label: '章节正文' },
    { key: 'extract', label: '拆剧本' },
    { key: 'storyboard', label: '分镜' },
    { key: 'video', label: '成片合成' }
] as const

export type CreationStage = (typeof STAGES)[number]['key']
type Step = { href: string; detail: string; completed?: boolean; onClick?: () => void }

function revealJourneyStep(nav: HTMLElement | null, step: HTMLAnchorElement | null) {
    if (!nav || !step) return
    const container = nav.getBoundingClientRect()
    const item = step.getBoundingClientRect()
    if (item.left < container.left || item.right > container.right) {
        nav.scrollBy({ left: item.left - container.left - (container.width - item.width) / 2 })
    }
}

export default function CreationJourney({ current, steps }: { current: CreationStage; steps: Record<CreationStage, Step> }) {
    const { locale, t } = useI18n()
    const activeStep = useRef<HTMLAnchorElement>(null)
    const navigation = useRef<HTMLElement>(null)
    useEffect(() => {
        // Scroll only this strip; changing stage must not move the writing canvas.
        const reveal = () => {
            const nav = navigation.current
            const focused = document.activeElement
            const step = focused instanceof HTMLAnchorElement && nav?.contains(focused) ? focused : activeStep.current
            revealJourneyStep(nav, step)
        }
        reveal()
        const resize = new ResizeObserver(reveal)
        if (navigation.current) resize.observe(navigation.current)
        return () => resize.disconnect()
    }, [current, locale])
    return (
        <header className="studio-journey-header flex shrink-0 items-center">
            <nav
                ref={navigation}
                aria-label={t('短剧创作流程')}
                className="studio-journey min-w-0 flex-1 overflow-x-auto novel-scroll">
                <ol className="studio-journey-list">
                    {STAGES.map(({ key, label }, index) => {
                        const step = steps[key]
                        const active = current === key
                        const description = `${t(label)} · ${t(step.detail)}`
                        return (
                            <li
                                key={key}
                                className={`studio-journey-item ${active ? 'is-active' : ''} ${step.completed ? 'is-complete' : ''}`}>
                                <Link
                                    ref={active ? activeStep : undefined}
                                    href={step.href}
                                    title={description}
                                    aria-label={`${description}${step.completed ? ` · ${t('已完成')}` : ''}`}
                                    onClick={step.onClick}
                                    onFocus={event => revealJourneyStep(navigation.current, event.currentTarget)}
                                    aria-current={active ? 'step' : undefined}
                                    className={`studio-journey-step ${active ? 'is-active' : ''} ${step.completed ? 'is-complete' : ''}`}>
                                    <span
                                        className="studio-journey-marker"
                                        aria-hidden="true">
                                        {step.completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
                                    </span>
                                    <span className="whitespace-nowrap text-xs font-medium">{t(label)}</span>
                                </Link>
                                {index < STAGES.length - 1 && (
                                    <ChevronRight
                                        className="studio-journey-arrow"
                                        aria-hidden="true"
                                    />
                                )}
                            </li>
                        )
                    })}
                </ol>
            </nav>
            <GlobalPreferences className="mx-3" />
        </header>
    )
}
