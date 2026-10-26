'use client'

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CloudUpload, Film, LogIn, RefreshCw } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import HomeLogoLink from '@/components/HomeLogoLink'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import DiagnosticMessage from '@/components/DiagnosticMessage'
import { useSignIn } from '@/components/SignInProvider'
import { getAuthSessionSnapshot, getAuthUser, isLoggedIn, onAuthChange } from '@/lib/auth'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import styles from './Uploads.module.css'

export type UploadSummary = {
    id: string
    title: string
    description: string | null
    coverUrl: string | null
    genre: string | null
    contentLanguage: string | null
    subtitleLanguages: string[]
    episodeCount: number
    visibility: string
    createdAt: string | null
    year: number | null
    cast: { name: string; role: string; job: string; imageUrl: string | null }[]
}

export function useUploadedResource<T>(url: string) {
    const snapshot = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    const userId = snapshot && isLoggedIn() ? getAuthUser()?.userId : null
    const [revision, setRevision] = useState(0)
    const key = `${userId}:${url}:${revision}`
    const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' })
    useEffect(() => {
        if (!userId) return
        const controller = new AbortController()
        void clientFetch(url, { signal: controller.signal })
            .then(readApiJson)
            .then(json => {
                if (controller.signal.aborted) return
                if (!json.success) throw new Error(json.error || '作品加载失败')
                setState({ key, data: json.data as T })
            })
            .catch(error => {
                if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '作品加载失败' })
            })
        return () => controller.abort()
    }, [url, userId, key])
    const current = state.key === key ? state : undefined
    return { userId, loading: snapshot === '' || Boolean(userId && !current), data: current?.data, error: current?.error, reload: () => setRevision(value => value + 1) }
}

export function UploadsState({ loading, userId, error, reload }: { loading: boolean; userId: string | null | undefined; error?: string; reload: () => void }) {
    const { t } = useI18n()
    const signIn = useSignIn()
    if (loading)
        return (
            <div
                className={styles.state}
                role="status">
                <RefreshCw
                    className={styles.spin}
                    size={28}
                />
                <p>{t('加载中…')}</p>
            </div>
        )
    if (!userId)
        return (
            <div className={styles.state}>
                <LogIn size={32} />
                <p>{t('请先登录')}</p>
                <button
                    className={styles.primary}
                    onClick={() => void signIn()}>
                    {t('登录 / 注册')}
                </button>
            </div>
        )
    if (error)
        return (
            <div
                className={styles.state}
                role="alert">
                <p>
                    <DiagnosticMessage message={error} />
                </p>
                <button
                    className={styles.secondary}
                    onClick={reload}>
                    <RefreshCw size={16} />
                    {t('重试')}
                </button>
            </div>
        )
    return null
}

export default function UploadsShell({ children }: { children: ReactNode }) {
    const { t } = useI18n()
    return (
        <div
            className={styles.page}
            data-i18n-skip>
            <SiteHeader
                sticky
                className={styles.header}
                contentClassName={styles.headerContent}>
                <HomeLogoLink showName />
                <nav
                    className={styles.nav}
                    aria-label={t('我的上传')}>
                    <Link
                        href="/uploads"
                        className={styles.current}>
                        <Film size={16} />
                        <span>{t('我的上传')}</span>
                    </Link>
                    <Link
                        href="/upload"
                        aria-label={t('上传影视')}
                        title={t('上传影视')}>
                        <CloudUpload size={16} />
                        <span>{t('上传影视')}</span>
                    </Link>
                </nav>
            </SiteHeader>
            <main className={styles.main}>{children}</main>
            <SiteFooter />
        </div>
    )
}
