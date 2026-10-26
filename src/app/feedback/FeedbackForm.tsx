'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, ImagePlus, Loader2, MessageSquare, Send, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { localizeDiagnostic } from '@/i18n/diagnostics'
import { useSignIn } from '@/components/SignInProvider'
import { getAuthSessionSnapshot, getAuthUser, onAuthChange } from '@/lib/auth'
import { clientFetch } from '@/lib/client-fetch'
import { FEEDBACK_MAX_CONTENT, FEEDBACK_MAX_FILES, FEEDBACK_RATE_MESSAGE, feedbackFileFormat, feedbackFileIssue, feedbackSourcePath, type FeedbackUpload } from '@/lib/site-feedback'

type AttachmentDraft = { id: string; file: File; preview: string; kind: 'image' | 'video'; uploaded?: FeedbackUpload; uploadedFor?: string }

export default function FeedbackForm() {
    const { t, locale } = useI18n()
    const signIn = useSignIn()
    const search = useSearchParams()
    const auth = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    const userId = auth ? getAuthUser()?.userId : undefined
    const [content, setContent] = useState('')
    const [files, setFiles] = useState<AttachmentDraft[]>([])
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState('')
    const [sent, setSent] = useState(false)
    const [cooldowns, setCooldowns] = useState<Record<string, number>>({})
    const remaining = cooldowns[String(userId ?? '')] ?? 0
    const setRemaining = useCallback((value: number | ((current: number) => number)) => {
        const id = String(getAuthUser()?.userId ?? '')
        setCooldowns(current => ({ ...current, [id]: typeof value === 'function' ? value(current[id] ?? 0) : value }))
    }, [])
    const busyRef = useRef(false)
    const urls = useRef(new Set<string>())
    const input = useRef<HTMLInputElement>(null)
    const coolingDown = remaining > 0

    useEffect(() => {
        const previews = urls.current
        return () => {
            for (const url of previews) URL.revokeObjectURL(url)
        }
    }, [])
    useEffect(() => {
        let active = true
        if (userId) {
            void clientFetch('/api/feedback', { suppressRateLimitToast: true })
                .then(response => response.json())
                .then(body => {
                    if (active && body.success) setRemaining(body.data.retryAfterSeconds)
                })
                .catch(() => {})
        }
        return () => {
            active = false
        }
    }, [userId, setRemaining])
    useEffect(() => {
        if (!coolingDown) return
        const timer = setInterval(() => setRemaining(value => Math.max(0, value - 1)), 1000)
        return () => clearInterval(timer)
    }, [coolingDown, setRemaining])

    function addFiles(selected: FileList | null) {
        if (!selected || busyRef.current) return
        const next = Array.from(selected)
        if (next.length + files.length > FEEDBACK_MAX_FILES) return setError('每次最多添加 5 个附件。')
        for (const file of next) {
            const issue = feedbackFileIssue(file)
            if (issue) return setError(issue)
        }
        const drafts = next.map(file => {
            const preview = URL.createObjectURL(file)
            urls.current.add(preview)
            return { id: crypto.randomUUID(), file, preview, kind: feedbackFileFormat(file)!.kind }
        })
        setFiles(current => [...current, ...drafts])
        setError('')
        setSent(false)
    }

    function removeFile(id: string) {
        const file = files.find(item => item.id === id)
        if (file) {
            URL.revokeObjectURL(file.preview)
            urls.current.delete(file.preview)
        }
        setFiles(current => current.filter(item => item.id !== id))
    }

    async function submit(event: FormEvent) {
        event.preventDefault()
        if (busyRef.current || !content.trim() || remaining > 0) return
        busyRef.current = true
        setBusy(true)
        setError('')
        setSent(false)
        setProgress(0)
        try {
            if (!(await signIn())) return
            const submittingUser = String(getAuthUser()?.userId ?? '')
            // Check again before uploading; POST enforces the same quota atomically.
            const quotaResponse = await clientFetch('/api/feedback', { suppressRateLimitToast: true })
            const quota = await quotaResponse.json()
            if (!quotaResponse.ok || !quota.success) throw new Error(quota.error || '反馈服务暂不可用，请稍后重试。')
            if (!quota.data.allowed) {
                setRemaining(quota.data.retryAfterSeconds)
                throw new Error(FEEDBACK_RATE_MESSAGE)
            }
            const receipts: string[] = []
            for (const [index, draft] of files.entries()) {
                let upload = draft.uploadedFor === submittingUser ? draft.uploaded : undefined
                if (!upload) {
                    const form = new FormData()
                    form.append('file', draft.file)
                    const response = await clientFetch('/api/feedback/upload', { method: 'POST', body: form, timeoutMs: 120_000, suppressRateLimitToast: true })
                    const result = await response.json()
                    if (!response.ok || !result.success) throw new Error(result.error || '附件上传失败，请检查文件后重试。')
                    upload = result.data as FeedbackUpload
                    setFiles(current => current.map(item => (item.id === draft.id ? { ...item, uploaded: upload, uploadedFor: submittingUser } : item)))
                }
                receipts.push(upload.receipt)
                setProgress(index + 1)
            }
            const response = await clientFetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content.trim(), receipts, pageName: feedbackSourcePath(search.get('from')) }),
                suppressRateLimitToast: true
            })
            const result = await response.json()
            if (!response.ok || !result.success) {
                if (response.status === 400) setFiles(current => current.map(item => ({ ...item, uploaded: undefined, uploadedFor: undefined })))
                if (response.status === 429) setRemaining(result.retryAfterSeconds || Number(response.headers.get('Retry-After')) || 60)
                throw new Error(result.error || '反馈提交失败，请稍后重试。')
            }
            setRemaining(result.data.retryAfterSeconds)
            setSent(true)
            setContent('')
            for (const url of urls.current) URL.revokeObjectURL(url)
            urls.current.clear()
            setFiles([])
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '反馈提交失败，请稍后重试。')
        } finally {
            busyRef.current = false
            setBusy(false)
        }
    }

    return (
        <section
            className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-16"
            data-i18n-skip>
            <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                <MessageSquare
                    size={24}
                    aria-hidden
                />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{t('意见反馈')}</h1>
                <p className="mt-2 text-sm text-slate-400">{t('反馈及附件仅保存到本机，可从本地工作区导出。')}</p>
            <p className="mt-3 text-sm leading-6 text-slate-400">{t('遇到问题或有新想法？告诉我们，帮助 makivue 做得更好。')}</p>
            <form
                onSubmit={submit}
                className="mt-8 space-y-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-8">
                <div>
                    <label
                        htmlFor="feedback-content"
                        className="mb-3 block text-sm font-medium">
                        {t('反馈内容')}
                    </label>
                    <textarea
                        id="feedback-content"
                        value={content}
                        required
                        maxLength={FEEDBACK_MAX_CONTENT}
                        rows={7}
                        disabled={busy}
                        onChange={event => {
                            setContent(event.target.value)
                            setSent(false)
                        }}
                        placeholder={t('请描述遇到的问题、操作步骤或你的建议。')}
                        aria-describedby="feedback-content-count"
                        className="w-full resize-y rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 outline-none transition placeholder:text-slate-500 focus:border-violet-400 disabled:opacity-60"
                    />
                    <p
                        id="feedback-content-count"
                        className="mt-2 text-end text-xs tabular-nums text-slate-500">
                        {content.length} / {FEEDBACK_MAX_CONTENT}
                    </p>
                </div>
                <div>
                    <p className="text-sm font-medium">{t('图片或视频（可选）')}</p>
                    <p
                        id="feedback-upload-help"
                        className="mt-2 text-xs leading-5 text-slate-400">
                        {t('最多 5 个附件。图片最大 10MB，视频最大 50MB。')}
                    </p>
                    <input
                        ref={input}
                        type="file"
                        multiple
                        hidden
                        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm"
                        aria-label={t('添加图片或视频')}
                        onChange={event => {
                            addFiles(event.target.files)
                            event.target.value = ''
                        }}
                    />
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {files.map(file => (
                            <div
                                key={file.id}
                                className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
                                {file.kind === 'image' ? (
                                    <Image
                                        src={file.preview}
                                        alt={file.file.name}
                                        width={240}
                                        height={144}
                                        unoptimized
                                        className="h-28 w-full object-contain"
                                    />
                                ) : (
                                    <video
                                        src={file.preview}
                                        controls
                                        preload="metadata"
                                        className="h-28 w-full"
                                        aria-label={file.file.name}
                                    />
                                )}
                                <p
                                    className="truncate px-3 py-2 text-xs text-slate-400"
                                    title={file.file.name}
                                    translate="no">
                                    {file.file.name}
                                </p>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => removeFile(file.id)}
                                    aria-label={`${t('移除附件')} ${file.file.name}`}
                                    className="absolute end-1 top-1 rounded-full bg-black/80 p-2 text-white disabled:opacity-40">
                                    <X
                                        size={14}
                                        aria-hidden
                                    />
                                </button>
                            </div>
                        ))}
                        {files.length < FEEDBACK_MAX_FILES && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => input.current?.click()}
                                aria-describedby="feedback-upload-help"
                                className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-5 text-sm text-slate-300 transition hover:border-violet-400 hover:text-violet-200 disabled:opacity-50">
                                <ImagePlus
                                    size={22}
                                    aria-hidden
                                />
                                {t('添加图片或视频')}
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-xs leading-5 text-slate-400">{t(FEEDBACK_RATE_MESSAGE)}</p>
                {error && (
                    <p
                        role="alert"
                        className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
                        {localizeDiagnostic(locale, error).text}
                    </p>
                )}
                {sent && (
                    <p
                        role="status"
                        className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">
                        <CheckCircle2
                            size={18}
                            aria-hidden
                        />
                        {t('反馈已保存在本地工作区')}
                    </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
                    <p className="text-xs text-slate-500">
                        {busy
                            ? t('正在提交…') + (files.length ? ` ${progress} / ${files.length}` : '')
                            : remaining > 0
                              ? t('{seconds} 秒后可再次提交', { seconds: remaining })
                              : !userId
                                ? t('提交前需要登录，已填写的内容会保留。')
                                : ''}
                    </p>
                    <button
                        type="submit"
                        disabled={busy || remaining > 0 || !content.trim()}
                        className="ms-auto inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
                        {busy ? (
                            <Loader2
                                size={16}
                                className="animate-spin"
                                aria-hidden
                            />
                        ) : (
                            <Send
                                size={16}
                                aria-hidden
                            />
                        )}
                        {t('提交反馈')}
                    </button>
                </div>
            </form>
        </section>
    )
}
