'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, Camera, CircleUserRound, Coins, CreditCard, IdCard, Loader2, LogIn, LogOut, Mail, Pencil, Save, Settings, Sparkles, UserRound, X } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import AuthBar from '@/components/AuthBar'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import HomeLogoLink from '@/components/HomeLogoLink'
import { clearAuthSession, getAuthSessionSnapshot, getAuthUser, isLoggedIn, onAuthChange, updateAuthUser, type AuthUser } from '@/lib/auth'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { PROFILE_AVATAR_EXTENSIONS, PROFILE_AVATAR_MAX_BYTES, PROFILE_DISPLAY_NAME_MAX_LENGTH } from '@/lib/profile'
import { POINTS_PER_USD } from '@/lib/recharge'
import { formatPointBalance } from '@/lib/points'

type WalletSummary = {
    balancePoints: number
    pointsPerUsd?: number
}

type WalletLoadState = {
    userId: string
    data: WalletSummary | null
    failed: boolean
}

type ProfileSummary = {
    displayName: string | null
    avatarUrl: string | null
}

function points(value: number, locale: string) {
    return formatPointBalance(value, locale)
}

function displayName(user: AuthUser) {
    return user.displayName?.trim() || user.email?.split('@')[0] || `UID ${user.userId}`
}

function userInitial(name: string) {
    return name[0]?.toUpperCase() ?? 'U'
}

function ProfileAvatar({ name, photoURL }: { name: string; photoURL?: string | null }) {
    if (photoURL) {
        return (
            <Image
                src={photoURL}
                alt=""
                width={112}
                height={112}
                unoptimized
                loading="eager"
                referrerPolicy="no-referrer"
                className="h-24 w-24 rounded-3xl object-cover border border-white/10 sm:h-28 sm:w-28"
            />
        )
    }

    return (
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 to-sky-500 text-3xl font-semibold text-white border border-white/10 sm:h-28 sm:w-28">
            {userInitial(name)}
        </div>
    )
}

function ProfileField({ icon, label, children, privateValue = false }: { icon: React.ReactNode; label: string; children: React.ReactNode; privateValue?: boolean }) {
    return (
        <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs text-slate-500">
                {icon}
                <span>{label}</span>
            </div>
            <div
                data-i18n-skip={privateValue ? true : undefined}
                className="mt-2 break-all text-sm font-medium text-slate-100 sm:text-base">
                {children}
            </div>
        </div>
    )
}

export default function ProfilePage() {
    const { locale, t } = useI18n()
    const authSnapshot = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    const ready = authSnapshot !== ''
    const user = ready && isLoggedIn() ? getAuthUser() : null
    const [walletState, setWalletState] = useState<WalletLoadState | null>(null)
    const currentWalletState = walletState && walletState.userId === user?.userId ? walletState : null
    const wallet = currentWalletState?.data ?? null
    const walletLoading = Boolean(user && !currentWalletState)
    const walletError = currentWalletState?.failed ?? false
    const avatarInputRef = useRef<HTMLInputElement>(null)
    const [editingProfile, setEditingProfile] = useState(false)
    const [draftDisplayName, setDraftDisplayName] = useState('')
    const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(null)
    const [draftAvatarFile, setDraftAvatarFile] = useState<File | null>(null)
    const [profileSaving, setProfileSaving] = useState(false)
    const [profileError, setProfileError] = useState<string | null>(null)
    const [profileSaved, setProfileSaved] = useState(false)
    const canSubmitProfile = Boolean(draftDisplayName.trim() && Array.from(draftDisplayName.trim()).length <= PROFILE_DISPLAY_NAME_MAX_LENGTH && draftAvatarUrl && !profileSaving)

    useEffect(() => {
        const userId = user?.userId
        if (!userId) return

        let cancelled = false
        clientFetch('/api/wallet/balance')
            .then(async response => {
                const json = (await response.json()) as { success: boolean; data?: WalletSummary; error?: string }
                if (!response.ok || !json.data) throw new Error(json.error ?? '账户余额加载失败')
                return json.data
            })
            .then(data => {
                if (!cancelled) setWalletState({ userId, data, failed: false })
            })
            .catch(() => {
                if (!cancelled) setWalletState({ userId, data: null, failed: true })
            })

        return () => {
            cancelled = true
        }
    }, [user?.userId])

    useEffect(() => {
        const userId = user?.userId
        if (!userId) return

        let cancelled = false
        clientFetch('/api/profile')
            .then(async response => {
                const json = (await response.json()) as { success: boolean; data?: ProfileSummary }
                if (!response.ok || !json.data) throw new Error('个人资料加载失败')
                return json.data
            })
            .then(profile => {
                if (cancelled || (!profile.displayName && !profile.avatarUrl)) return
                updateAuthUser({
                    ...(profile.displayName ? { displayName: profile.displayName } : {}),
                    ...(profile.avatarUrl ? { photoURL: profile.avatarUrl } : {})
                })
            })
            .catch(() => {})

        return () => {
            cancelled = true
        }
    }, [user?.userId])

    useEffect(() => {
        if (!draftAvatarUrl?.startsWith('blob:')) return
        return () => URL.revokeObjectURL(draftAvatarUrl)
    }, [draftAvatarUrl])

    function startEditingProfile() {
        if (!user) return
        setDraftDisplayName(displayName(user))
        setDraftAvatarUrl(user.photoURL?.trim() || null)
        setDraftAvatarFile(null)
        setProfileError(null)
        setProfileSaved(false)
        setEditingProfile(true)
    }

    function cancelEditingProfile() {
        setEditingProfile(false)
        setDraftAvatarFile(null)
        setDraftAvatarUrl(null)
        setProfileError(null)
    }

    function selectAvatar(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        if (!PROFILE_AVATAR_EXTENSIONS[file.type]) {
            setProfileError('头像仅支持 JPG、PNG、WebP 格式')
            return
        }
        if (file.size > PROFILE_AVATAR_MAX_BYTES) {
            setProfileError('头像图片不能超过 5MB')
            return
        }
        setDraftAvatarFile(file)
        setDraftAvatarUrl(URL.createObjectURL(file))
        setProfileError(null)
        setProfileSaved(false)
    }

    async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!user) return
        const normalizedDisplayName = draftDisplayName.trim()
        if (!normalizedDisplayName) {
            setProfileError('请输入昵称')
            return
        }
        if (!draftAvatarUrl) {
            setProfileError('请上传头像')
            return
        }

        setProfileSaving(true)
        setProfileError(null)
        setProfileSaved(false)
        try {
            const form = new FormData()
            form.set('displayName', normalizedDisplayName)
            if (draftAvatarFile) form.set('avatar', draftAvatarFile)
            else if (user.photoURL) form.set('avatarUrl', user.photoURL)

            const response = await clientFetch('/api/profile', {
                method: 'PUT',
                body: form,
                timeoutMs: 60_000
            })
            const json = (await readApiJson(response)) as { success: boolean; data?: ProfileSummary; error?: string }
            if (!response.ok || !json.success || !json.data?.displayName || !json.data.avatarUrl) {
                throw new Error(json.error ?? '资料保存失败，请稍后重试')
            }
            if (json.data.displayName !== normalizedDisplayName) throw new Error('资料保存失败：服务端未保存新昵称')
            updateAuthUser({ displayName: json.data.displayName, photoURL: json.data.avatarUrl })
            setEditingProfile(false)
            setDraftAvatarFile(null)
            setDraftAvatarUrl(null)
            setProfileSaved(true)
        } catch (error) {
            setProfileError(error instanceof Error ? error.message : '资料保存失败，请稍后重试')
        } finally {
            setProfileSaving(false)
        }
    }

    return (
        <div className="app-page flex min-h-screen flex-col text-slate-100">
            <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_22%_0%,rgba(124,58,237,0.18),transparent_38%),radial-gradient(circle_at_78%_4%,rgba(14,165,233,0.12),transparent_34%)]" />

            <SiteHeader
                sticky
                className="z-30"
                contentClassName="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                    <HomeLogoLink />
                    <Link
                        href="/projects"
                        aria-label={t('返回我的项目')}
                        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-slate-400 transition hover:border-violet-400/30 hover:text-white">
                        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                    </Link>
                    <div className="min-w-0">
                        <h1 className="truncate text-base font-semibold text-white sm:text-lg">{t('个人中心')}</h1>
                        <p className="hidden text-xs text-slate-600 sm:block">{t('管理你的账户信息与创作入口')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <AuthBar variant="compact" />
                </div>
            </SiteHeader>

            <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
                {!ready ? (
                    <div className="mx-auto h-72 max-w-4xl animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.025]" />
                ) : !user ? (
                    <section className="mx-auto max-w-lg rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 text-center shadow-2xl shadow-black/20 sm:p-10">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                            <LogIn className="h-7 w-7" />
                        </div>
                        <h2 className="mt-5 text-xl font-semibold text-white">{t('登录后查看个人资料')}</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500">{t('登录后可查看头像、昵称、用户 ID 与账户信息。')}</p>
                        <p className="mt-6 text-xs text-slate-600">{t('请打开本地工作区。')}</p>
                    </section>
                ) : (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-6">
                            <section className="relative overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.18] via-fuchsia-500/[0.07] to-sky-500/[0.05] p-6 shadow-2xl shadow-black/20 sm:p-8">
                                <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl" />
                                <form
                                    onSubmit={saveProfile}
                                    className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
                                    <div
                                        className="relative w-fit shrink-0"
                                        data-i18n-skip>
                                        <ProfileAvatar
                                            name={editingProfile ? draftDisplayName.trim() || displayName(user) : displayName(user)}
                                            photoURL={editingProfile ? draftAvatarUrl : user.photoURL}
                                        />
                                        {editingProfile ? (
                                            <button
                                                type="button"
                                                onClick={() => avatarInputRef.current?.click()}
                                                aria-label={t('上传新头像')}
                                                className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-3xl bg-black/55 text-xs font-medium text-white opacity-0 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
                                                <Camera className="h-5 w-5" />
                                                {draftAvatarUrl ? '更换头像' : '上传头像'}
                                            </button>
                                        ) : null}
                                        <input
                                            ref={avatarInputRef}
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp"
                                            onChange={selectAvatar}
                                            className="sr-only"
                                            tabIndex={-1}
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                                                <BadgeCheck className="h-3.5 w-3.5" />
                                                {t('已登录')}
                                            </div>
                                            {!editingProfile ? (
                                                <button
                                                    type="button"
                                                    onClick={startEditingProfile}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-violet-400/30 hover:bg-violet-400/10 hover:text-white">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    {t('编辑资料')}
                                                </button>
                                            ) : null}
                                        </div>
                                        {editingProfile ? (
                                            <div>
                                                <label
                                                    htmlFor="profile-display-name"
                                                    className="mb-1.5 block text-xs text-slate-400">
                                                    {t('昵称')}
                                                </label>
                                                <input
                                                    id="profile-display-name"
                                                    value={draftDisplayName}
                                                    onChange={event => {
                                                        setDraftDisplayName(event.target.value)
                                                        setProfileError(null)
                                                        setProfileSaved(false)
                                                    }}
                                                    maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
                                                    autoComplete="nickname"
                                                    placeholder={t('请输入昵称')}
                                                    className="w-full rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-base font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400/50 sm:text-lg"
                                                />
                                            </div>
                                        ) : (
                                            <h2
                                                data-i18n-skip
                                                className="truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                                                {displayName(user)}
                                            </h2>
                                        )}
                                        <p
                                            data-i18n-skip
                                            className="mt-2 truncate text-sm text-slate-400">
                                            {user.email ?? `UID ${user.userId}`}
                                        </p>
                                        {editingProfile ? (
                                            <div className="mt-4">
                                                <p className="text-xs text-slate-500">{t('头像和昵称均为必填项，头像支持 JPG、PNG、WebP，最大 5MB。')}</p>
                                                {profileError ? (
                                                    <p
                                                        className="mt-2 text-xs text-red-300"
                                                        role="alert">
                                                        {profileError}
                                                    </p>
                                                ) : null}
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button
                                                        type="submit"
                                                        disabled={!canSubmitProfile}
                                                        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40">
                                                        {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                                        {profileSaving ? '保存中...' : '保存资料'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={cancelEditingProfile}
                                                        disabled={profileSaving}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40">
                                                        <X className="h-4 w-4" />
                                                        {t('取消')}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : profileSaved ? (
                                            <p
                                                className="mt-3 text-xs text-emerald-300"
                                                role="status">
                                                {t('个人资料已保存')}
                                            </p>
                                        ) : null}
                                    </div>
                                </form>
                            </section>

                            <section className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
                                <div className="flex items-center gap-2">
                                    <CircleUserRound className="h-5 w-5 text-violet-300" />
                                    <h2 className="font-semibold text-white">{t('账户信息')}</h2>
                                </div>
                                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                    <ProfileField
                                        icon={<UserRound className="h-4 w-4 text-sky-300" />}
                                        label={t('昵称')}
                                        privateValue>
                                        {displayName(user)}
                                    </ProfileField>
                                    <ProfileField
                                        icon={<IdCard className="h-4 w-4 text-violet-300" />}
                                        label={t('用户 ID')}
                                        privateValue>
                                        {user.userId}
                                    </ProfileField>
                                    <ProfileField
                                        icon={<Mail className="h-4 w-4 text-amber-300" />}
                                        label={t('邮箱地址')}>
                                        {user.email ? <span data-i18n-skip>{user.email}</span> : '未提供'}
                                    </ProfileField>
                                    <ProfileField
                                        icon={<BadgeCheck className="h-4 w-4 text-emerald-300" />}
                                        label={t('账号角色')}>
                                        {user.isAdmin ? '管理员' : '普通用户'}
                                    </ProfileField>
                                </div>
                            </section>
                        </div>

                        <aside className="space-y-6">
                            <section className="relative overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.18] via-fuchsia-500/[0.08] to-sky-500/[0.06] p-5 shadow-xl shadow-black/20">
                                <div className="absolute -right-12 -top-14 h-36 w-36 rounded-full bg-violet-400/15 blur-3xl" />
                                <div className="relative">
                                    <div className="flex items-center gap-2 text-sm text-violet-200">
                                        <Coins className="h-4 w-4" />
                                        <h2 className="font-semibold">{t('剩余积分')}</h2>
                                    </div>
                                    {walletLoading ? (
                                        <div className="mt-4 flex h-11 items-center text-slate-500">
                                            <Loader2 className="me-2 h-4 w-4 animate-spin" />
                                            {t('正在加载积分账户...')}
                                        </div>
                                    ) : walletError ? (
                                        <div className="mt-4 text-3xl font-bold text-slate-500">—</div>
                                    ) : (
                                        <div
                                            data-i18n-skip
                                            className="mt-4 text-4xl font-bold tracking-tight text-white">
                                            {points(wallet?.balancePoints ?? 0, locale)}
                                        </div>
                                    )}
                                    <div className="mt-3 text-xs text-slate-400">
                                        <span data-i18n-skip>$1 = {wallet?.pointsPerUsd ?? POINTS_PER_USD}</span> <span>{t('积分')}</span>
                                    </div>
                                    <Link
                                        href="/wallet"
                                        className="mt-5 flex w-full items-center justify-between rounded-xl border border-violet-300/15 bg-violet-400/[0.09] px-3.5 py-3 text-sm font-medium text-violet-100 transition hover:border-violet-300/30 hover:bg-violet-400/[0.14]">
                                        {t('积分与充值')}
                                        <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                                    </Link>
                                </div>
                            </section>

                            <section className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-violet-300" />
                                    <h2 className="font-semibold text-white">{t('快捷入口')}</h2>
                                </div>
                                <nav className="mt-4 space-y-2">
                                    <Link
                                        href="/projects"
                                        className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 text-sm text-slate-300 transition hover:border-violet-400/25 hover:bg-violet-500/[0.08] hover:text-white">
                                        <Sparkles className="h-4 w-4 text-violet-300" />
                                        {t('我的项目')}
                                    </Link>
                                    <Link
                                        href="/wallet"
                                        className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 text-sm text-slate-300 transition hover:border-sky-400/25 hover:bg-sky-500/[0.08] hover:text-white">
                                        <CreditCard className="h-4 w-4 text-sky-300" />
                                        {t('积分与充值')}
                                    </Link>
                                    <Link
                                        href="/settings"
                                        className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 text-sm text-slate-300 transition hover:border-amber-400/25 hover:bg-amber-500/[0.08] hover:text-white">
                                        <Settings className="h-4 w-4 text-amber-300" />
                                        {t('系统设置')}
                                    </Link>
                                </nav>
                            </section>

                            <section className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5">
                                <h2 className="text-sm font-semibold text-white">{t('账户安全')}</h2>
                                <p className="mt-2 text-xs leading-5 text-slate-500">{t('个人资料保存在当前浏览器。重置后，本设备上的个人资料会被清除。')}</p>
                                <button
                                    type="button"
                                    onClick={clearAuthSession}
                                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/15 bg-red-400/[0.06] px-3 py-2.5 text-sm text-red-300 transition hover:border-red-400/30 hover:bg-red-400/10">
                                    <LogOut className="h-4 w-4" />
                                    {t('退出当前账号')}
                                </button>
                            </section>
                        </aside>
                    </div>
                )}
            </main>
            <SiteFooter />
        </div>
    )
}
