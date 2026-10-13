'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Copy, RotateCcw } from 'lucide-react'
import type { KnowledgeCopy } from '@/i18n/knowledge'
import styles from './knowledge.module.css'

export function KnowledgeContents({ sections, labels: copy }: { sections: { id: string; number: string; label: string }[]; labels: Pick<KnowledgeCopy, 'toc' | 'jumpChecklist'> }) {
    const [active, setActive] = useState(sections[0].id)

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                if (visible[0]) setActive(visible[0].target.id)
            },
            { rootMargin: '-10% 0px -65% 0px' }
        )
        for (const section of sections) {
            const element = document.getElementById(section.id)
            if (element) observer.observe(element)
        }
        return () => observer.disconnect()
    }, [sections])

    return (
        <div className={styles.toc}>
            <p className={styles.tocTitle}>{copy.toc}</p>
            <nav aria-label={copy.toc}>
                {sections.map(section => (
                    <a
                        key={section.id}
                        href={`#${section.id}`}
                        aria-current={active === section.id ? 'location' : undefined}
                        onClick={() => setActive(section.id)}>
                        <span>{section.number}</span>
                        {section.label}
                    </a>
                ))}
            </nav>
            <a
                className={styles.tocChecklist}
                href="#checklist">
                {copy.jumpChecklist}
                <ArrowUpRight size={15} />
            </a>
        </div>
    )
}

export function PromptBlock({ text, labels: copy }: { text: string; labels: Pick<KnowledgeCopy, 'prompt' | 'copy' | 'copied' | 'copyFailed'> }) {
    const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

    async function copyPrompt() {
        try {
            await navigator.clipboard.writeText(text)
            setStatus('copied')
        } catch {
            setStatus('failed')
        }
    }

    return (
        <div className={styles.prompt}>
            <div className={styles.promptHeader}>
                <span>{copy.prompt}</span>
                <button
                    type="button"
                    onClick={copyPrompt}>
                    {status === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                    {status === 'copied' ? copy.copied : copy.copy}
                </button>
            </div>
            <pre>{text}</pre>
            <span
                role="status"
                className={status === 'failed' ? styles.copyStatus : 'sr-only'}>
                {status === 'failed' ? copy.copyFailed : status === 'copied' ? copy.copied : ''}
            </span>
        </div>
    )
}

export function ProductionChecklist({ copy }: { copy: Pick<KnowledgeCopy, 'checklist' | 'checklistProgress' | 'checklistLabel' | 'checklistReady' | 'checklistPending' | 'reset'> }) {
    const [checked, setChecked] = useState<number[]>([])
    const complete = checked.length === copy.checklist.length

    return (
        <div className={styles.checklist}>
            <div className={styles.checklistHeader}>
                <p aria-live="polite">
                    <strong>{checked.length}</strong> / {copy.checklist.length} {copy.checklistProgress}
                </p>
                <button
                    type="button"
                    onClick={() => setChecked([])}>
                    <RotateCcw size={14} />
                    {copy.reset}
                </button>
            </div>
            <fieldset>
                <legend className="sr-only">{copy.checklistLabel}</legend>
                {copy.checklist.map((item, index) => (
                    <label key={index}>
                        <input
                            type="checkbox"
                            checked={checked.includes(index)}
                            onChange={event => setChecked(previous => (event.target.checked ? [...previous, index] : previous.filter(value => value !== index)))}
                        />
                        <span>{item}</span>
                    </label>
                ))}
            </fieldset>
            <p
                className={styles.checklistStatus}
                role="status">
                {complete ? copy.checklistReady : copy.checklistPending}
            </p>
        </div>
    )
}
