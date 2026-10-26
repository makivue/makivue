'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Loader2, X } from 'lucide-react'
import { clientFetch } from '@/lib/client-fetch'
import { readCreatorApiResponse, creatorGenerationErrorMessage } from '@/lib/creator-api-response'
import { readCreatorGenerationPoll } from '@/lib/creator-generation-poll'
import { getAuthUser } from '@/lib/auth'
import { useI18n } from '@/i18n/I18nProvider'
import CustomSelect from '@/components/CustomSelect'
import DiagnosticMessage from '@/components/DiagnosticMessage'
import type { CreatorAsset } from './creator-session'
import type { CreatorMergeRatio } from '@/lib/creator-video-merge'
import { CREATOR_MERGE_MAX_CLIPS, CREATOR_MERGE_MAX_SECONDS } from '@/lib/creator-video-merge'
import styles from './VideoMergeComposer.module.css'

type MergeJob = { id: string; phase: string; progress: number; total: number; error?: string; result?: { asset?: CreatorAsset } }

export default function VideoMergeComposer({
    userId,
    requireAuth,
    assets,
    assetsLoading,
    nextCursor,
    onLoadMore,
    onComplete
}: {
    userId: string | null
    requireAuth: () => Promise<boolean>
    assets: CreatorAsset[]
    assetsLoading: boolean
    nextCursor: string | null
    onLoadMore: () => void
    onComplete: (asset: CreatorAsset) => void
}) {
    const { t } = useI18n()
    const [clips, setClips] = useState<CreatorAsset[]>([])
    const [title, setTitle] = useState('')
    const [ratio, setRatio] = useState<CreatorMergeRatio>('16:9')
    const [job, setJob] = useState<MergeJob | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [recovering, setRecovering] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const deliveredJob = useRef<string | null>(null)
    const requestRef = useRef<{ source: string; key: string } | null>(null)
    const active = !!job && ['queued', 'generating', 'writing_db'].includes(job.phase)
    const jobId = job?.id
    const busy = active || submitting || (recovering && !!userId)
    const totalSeconds = clips.reduce((sum, clip) => sum + (clip.duration ?? 0), 0)
    const selectedIds = new Set(clips.map(clip => clip.id))

    const acceptJob = useCallback(
        (next: MergeJob) => {
            setJob(next)
            if (next.phase === 'error') requestRef.current = null
            if (next.phase === 'done' && next.result?.asset && deliveredJob.current !== next.id) {
                deliveredJob.current = next.id
                onComplete(next.result.asset)
            }
        },
        [onComplete]
    )

    const restore = useCallback(async () => {
        if (!userId) return
        setRecovering(true)
        try {
            const response = await clientFetch('/api/create/video/merge', { timeoutMs: 20_000 })
            const json = await readCreatorApiResponse(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '拼接任务加载失败')
            if (getAuthUser()?.userId !== userId) return
            setError(null)
            if (json.data.job) acceptJob(json.data.job)
        } catch (error) {
            setError(creatorGenerationErrorMessage(error))
        } finally {
            setRecovering(false)
        }
    }, [userId, acceptJob])

    useEffect(() => {
        const timer = window.setTimeout(() => void restore(), 0)
        return () => window.clearTimeout(timer)
    }, [restore])

    useEffect(() => {
        if (!userId || !jobId || !active) return
        let stopped = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const poll = async () => {
            try {
                const data = await readCreatorGenerationPoll(`/api/create/video/merge/${encodeURIComponent(jobId)}`, '视频拼接状态查询失败')
                if (stopped || getAuthUser()?.userId !== userId) return
                if (data?.job) {
                    acceptJob(data.job)
                    setError(null)
                }
            } catch (error) {
                if (!stopped) setError(creatorGenerationErrorMessage(error))
            } finally {
                if (!stopped) timer = setTimeout(() => void poll(), 4000)
            }
        }
        timer = setTimeout(() => void poll(), 1000)
        return () => {
            stopped = true
            if (timer) clearTimeout(timer)
        }
    }, [jobId, active, userId, acceptJob])

    async function submit() {
        if (busy || clips.length < 2 || !title.trim() || totalSeconds > CREATOR_MERGE_MAX_SECONDS) return
        setSubmitting(true)
        setError(null)
        try {
            if (!(await requireAuth())) return
            const assetIds = clips.map(clip => clip.id)
            const source = JSON.stringify([assetIds, title.trim(), ratio])
            if (!requestRef.current || requestRef.current.source !== source) requestRef.current = { source, key: crypto.randomUUID() }
            const response = await clientFetch('/api/create/video/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assetIds, title: title.trim(), ratio, requestKey: requestRef.current.key }),
                timeoutMs: 30_000
            })
            const json = await readCreatorApiResponse(response, 'generation')
            if (!response.ok || !json.success) throw new Error(json.error ?? '视频拼接提交失败')
            setJob({ id: json.data.jobId, phase: 'queued', progress: 0, total: clips.length })
        } catch (error) {
            setError(creatorGenerationErrorMessage(error))
        } finally {
            setSubmitting(false)
        }
    }

    function move(index: number, direction: number) {
        setClips(current => {
            const next = [...current]
            const moving = next[index]
            next[index] = next[index + direction]
            next[index + direction] = moving
            return next
        })
    }

    return (
        <section
            className={styles.composer}
            aria-label={t('长视频拼接')}>
            <h2>{t('把片段拼成一条完整视频')}</h2>
            <p className={styles.note}>{t('按列表顺序拼接，保留各段原声；统一尺寸并加留边，不裁切画面。')}</p>
            <div className={styles.settings}>
                <label>
                    {t('成片标题')}
                    <input
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        maxLength={120}
                        disabled={busy}
                        placeholder={t('为这条长视频取个名字')}
                    />
                </label>
                <div>
                    <span>{t('输出比例')}</span>
                    <CustomSelect
                        value={ratio}
                        onChange={value => setRatio(value as CreatorMergeRatio)}
                        disabled={busy}
                        ariaLabel="输出比例"
                        options={['16:9', '9:16', '1:1', '21:9'].map(value => ({ value, label: value }))}
                    />
                </div>
            </div>
            <div
                className={styles.summary}
                role="status">
                {t('已选 {count} 个片段，预计 {seconds} 秒', { count: clips.length, seconds: totalSeconds })}
            </div>
            <ol className={styles.clips}>
                {clips.map((clip, index) => (
                    <li key={clip.id}>
                        <span className={styles.index}>{index + 1}</span>
                        <span
                            className={styles.clipName}
                            data-i18n-skip>
                            {clip.prompt || t('未记录提示词')}
                        </span>
                        <span>{t('{seconds} 秒', { seconds: clip.duration ?? 0 })}</span>
                        <button
                            type="button"
                            onClick={() => move(index, -1)}
                            disabled={busy || index === 0}
                            aria-label={t('片段上移')}>
                            <ArrowUp size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => move(index, 1)}
                            disabled={busy || index === clips.length - 1}
                            aria-label={t('片段下移')}>
                            <ArrowDown size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setClips(current => current.filter(item => item.id !== clip.id))}
                            disabled={busy}
                            aria-label={t('移除片段')}>
                            <X size={16} />
                        </button>
                    </li>
                ))}
            </ol>
            <p className={styles.note}>{t('选择 2–20 个视频片段，总时长不超过 10 分钟。')}</p>
            {!userId ? (
                <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void requireAuth()}>
                    {t('登录后选择视频片段')}
                </button>
            ) : (
                <>
                    <h3>{t('选择我的视频片段')}</h3>
                    {assetsLoading && assets.length === 0 ? (
                        <p role="status">{t('加载中...')}</p>
                    ) : assets.length === 0 ? (
                        <p className={styles.note}>{t('还没有视频片段，先用直接生成或主题成片制作。')}</p>
                    ) : (
                        <div className={styles.library}>
                            {assets
                                .filter(asset => asset.type === 'video')
                                .map(asset => (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        aria-pressed={selectedIds.has(asset.id)}
                                        disabled={busy || (!selectedIds.has(asset.id) && clips.length >= CREATOR_MERGE_MAX_CLIPS)}
                                        onClick={() => setClips(current => (selectedIds.has(asset.id) ? current.filter(clip => clip.id !== asset.id) : [...current, asset]))}>
                                        {asset.coverUrl && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={asset.coverUrl}
                                                alt={asset.prompt?.trim() || t('视频封面')}
                                                data-i18n-skip
                                            />
                                        )}
                                        <span
                                            className={styles.assetTitle}
                                            data-i18n-skip>
                                            {asset.prompt || t('未记录提示词')}
                                        </span>
                                        <span>
                                            {asset.ratio ?? ''} · {t('{seconds} 秒', { seconds: asset.duration ?? 0 })}
                                        </span>
                                        {selectedIds.has(asset.id) && (
                                            <Check
                                                size={16}
                                                className={styles.check}
                                            />
                                        )}
                                    </button>
                                ))}
                        </div>
                    )}
                    {nextCursor && (
                        <button
                            type="button"
                            disabled={assetsLoading}
                            onClick={onLoadMore}>
                            {t('加载更多')}
                        </button>
                    )}
                    <div className={styles.actions}>
                        <p className={styles.note}>{t('使用本机 FFmpeg 拼接，保留片段原声。')}</p>
                        <button
                            type="button"
                            className={styles.primary}
                            onClick={() => void submit()}
                            disabled={busy || !title.trim() || clips.length < 2 || totalSeconds > CREATOR_MERGE_MAX_SECONDS}>
                            {busy && (
                                <Loader2
                                    size={18}
                                    className="animate-spin"
                                />
                            )}
                            {t(submitting ? '提交中...' : active ? '正在拼接' : '开始拼接')}
                        </button>
                    </div>
                </>
            )}
            {job && (
                <div
                    role="status"
                    className={styles.status}>
                    {t(job.phase === 'done' ? '拼接完成，已保存到我的作品。' : job.phase === 'error' ? '拼接失败，可调整片段后重新提交。' : '本机正在处理，关闭浏览器页面后仍会继续；请保持应用服务运行。')}
                    {active && <p>{t('已处理 {completed}/{total} 个片段', { completed: job.progress, total: job.total })}</p>}
                    {job.phase === 'error' && job.error && <DiagnosticMessage message={job.error} />}
                </div>
            )}
            {error && (
                <p
                    role="alert"
                    className={styles.error}>
                    <DiagnosticMessage message={error} />{' '}
                    <button
                        type="button"
                        onClick={() => void restore()}
                        disabled={recovering}>
                        {t('刷新任务状态')}
                    </button>
                </p>
            )}
        </section>
    )
}
