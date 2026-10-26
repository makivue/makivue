'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, Clapperboard, Film, ImagePlus, Palette, Play, CloudUpload } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { knowledgeNavLabel } from '@/i18n/knowledge.zh'
import styles from './CreationModeNav.module.css'

const modes = [
    { key: 'drama', label: 'AI 短剧', Icon: Clapperboard },
    { key: 'anime', label: '漫剧 / 二次元', Icon: Palette },
    { key: 'video', label: 'AI 视频', Icon: Film },
    { key: 'image', label: 'AI 图片', Icon: ImagePlus },
    { key: 'works', label: '看短剧', Icon: Play },
    { key: 'upload', label: '上传影视', Icon: CloudUpload }
] as const

export default function CreationModeNav({ mode, showHowToUse = false }: { mode: (typeof modes)[number]['key']; showHowToUse?: boolean }) {
    const { t, locale } = useI18n()
    const panelId = useId()
    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const current = modes.find(item => item.key === mode)!
    const CurrentIcon = current.Icon

    useEffect(() => {
        const closeOnResize = () => panelRef.current?.hidePopover()
        const closeOnScroll = (event: Event) => {
            if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
            panelRef.current?.hidePopover()
        }
        window.addEventListener('resize', closeOnResize)
        document.addEventListener('scroll', closeOnScroll, true)
        return () => {
            window.removeEventListener('resize', closeOnResize)
            document.removeEventListener('scroll', closeOnScroll, true)
        }
    }, [])

    function positionPanel() {
        const trigger = triggerRef.current
        const panel = panelRef.current
        if (!trigger || !panel) return
        const rect = trigger.getBoundingClientRect()
        const width = Math.min(256, window.innerWidth - 24)
        const left = document.documentElement.dir === 'rtl' ? rect.right - width : rect.left
        const top = rect.bottom + 8
        panel.style.width = `${width}px`
        panel.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`
        panel.style.top = `${top}px`
        panel.style.maxHeight = `${Math.max(0, window.innerHeight - top - 12)}px`
    }

    function links(inPanel = false) {
        return (
            <>
                {modes.map(({ key, label, Icon }) => (
                    <Link
                        key={key}
                        href={key === 'drama' ? '/' : key === 'anime' ? '/anime' : key === 'works' ? '/works' : key === 'upload' ? '/upload' : `/ai${key}`}
                        aria-current={mode === key ? 'page' : undefined}
                        title={t(label)}
                        onClick={inPanel ? () => panelRef.current?.hidePopover() : undefined}
                        className={inPanel ? styles.menuLink : styles.tab}>
                        <Icon aria-hidden="true" />
                        <span>{t(label)}</span>
                        {inPanel && mode === key && <Check aria-hidden="true" />}
                    </Link>
                ))}
                {showHowToUse && (
                    <Link
                        href="/how-to-use"
                        title={knowledgeNavLabel[locale]}
                        onClick={inPanel ? () => panelRef.current?.hidePopover() : undefined}
                        className={inPanel ? `${styles.menuLink} ${styles.guideLink}` : styles.tab}>
                        <BookOpen aria-hidden="true" />
                        <span>{knowledgeNavLabel[locale]}</span>
                    </Link>
                )}
            </>
        )
    }

    return (
        <nav
            data-i18n-skip
            aria-label={t('AI 创作台')}
            className={styles.nav}>
            <div className={styles.tabs}>{links()}</div>
            <div className={styles.breadcrumb}>
                <span
                    className={styles.separator}
                    aria-hidden="true">
                    /
                </span>
                <button
                    ref={triggerRef}
                    type="button"
                    title={t('AI 创作台')}
                    aria-controls={panelId}
                    aria-expanded={open}
                    popoverTarget={panelId}
                    className={styles.trigger}>
                    <CurrentIcon
                        aria-hidden="true"
                        className={styles.currentIcon}
                    />
                    <span>{t(current.label)}</span>
                    <ChevronDown
                        aria-hidden="true"
                        className={styles.chevron}
                    />
                </button>
            </div>
            <div
                ref={panelRef}
                id={panelId}
                popover="auto"
                onBeforeToggle={event => {
                    if (event.newState === 'open') positionPanel()
                }}
                onToggle={event => setOpen(event.newState === 'open')}
                className={styles.menu}>
                {links(true)}
            </div>
        </nav>
    )
}
