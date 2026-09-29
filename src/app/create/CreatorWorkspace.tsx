'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link, { useRouter } from '@/i18n/navigation'
import {
    ArrowUp,
    Paperclip,
    RectangleHorizontal,
    ArrowLeft,
    Check,
    CheckSquare,
    ChevronDown,
    Clock3,
    Download,
    ImageIcon,
    Images,
    Loader2,
    Play,
    Plus,
    Sparkles,
    Trash2,
    Upload,
    Video,
    X
} from 'lucide-react'
import AuthBar from '@/components/AuthBar'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import WalletBalance from '@/components/WalletBalance'
import CustomSelect from '@/components/CustomSelect'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import CreationModeNav from './CreationModeNav'
import DramaSettingsDialog from './drama/DramaSettingsDialog'
import styles from './CreatorWorkspace.module.css'
import HomeLogoLink from '@/components/HomeLogoLink'
import { clientFetch } from '@/lib/client-fetch'
import { CREATION_PRODUCTS } from '@/lib/creation-products'
import { runWithConcurrency } from '@/lib/bounded-concurrency'
import { getPollingDelay } from '@/lib/polling'
import { getAuthUser, isLoggedIn } from '@/lib/auth'
import { useCreationAuth } from './useCreationAuth'
import { pushToast } from '@/components/Toast'
import type { ImageProviderSwitch } from '@/lib/image-generation-recovery'
import {
    getImageProviderCapability,
    getVideoProviderCapability,
    isHiModelsH3Provider,
    normalizeVideoDuration,
    SEEDANCE_20_LABEL,
    SEEDANCE_25_LABEL,
    WAN_3_PRIME_LABEL
} from '@/lib/provider-capabilities'
import { isHiModelsImageModel } from '@/lib/himodels-models'
import { isGenerationModelVisible } from '@/lib/model-display'
import { useI18n } from '@/i18n/I18nProvider'
import { creatorReferenceLimitMessage, MAX_CREATOR_REFERENCE_IMAGES, validateCreatorReferenceImages } from '@/lib/creator-reference-images'
import { MAX_IMAGE_REFERENCE_VIDEOS } from '@/lib/creator-reference-video'
import {
    formatReferenceVideoDurationViolation,
    getReferenceVideoDurationViolation,
    MAX_REFERENCE_VIDEO_BYTES,
    MAX_STORYBOARD_REFERENCE_VIDEOS,
    parseStoryboardReferenceVideos,
    resolveReferenceVideoMimeType,
    type StoryboardReferenceVideo
} from '@/lib/storyboard-reference-videos'

import { useCreatorState, useRemoveCreatorAssets } from './CreatorSessionProvider'
import type { Mode, ImageModel, VideoModel, AssetFilter, AspectRatio, CreatorAsset } from './creator-session'

const EXAMPLES = {
    image: ['雨夜霓虹街头，一位侦探撑伞回望，电影感光影', '清晨薄雾中的东方山水，飞鸟掠过湖面，写实摄影'],
    video: ['镜头缓慢推进，海边灯塔在暴风雨中亮起，海浪拍击礁石', '一只橘猫从窗台跃下，阳光穿过窗帘，镜头轻柔跟随']
}

const IMAGE_MODEL_LABELS: Record<string, string> = {
    banana: 'Nano Banana',
    'qwen-image-3.0-pro': 'Qwen-Image',
    doubao: 'Seedream 5.0 Lite',
    'gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
    'seedream-5-0-lite': 'Seedream 5.0 Lite'
}

const IMAGE_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
    { value: '1:1', label: '方形' },
    { value: '16:9', label: '横屏' },
    { value: '9:16', label: '竖屏' },
    { value: '4:3', label: '标准' },
    { value: '3:4', label: '竖版' }
]

const VIDEO_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
    { value: '21:9', label: '超宽屏' },
    { value: '16:9', label: '横屏' },
    { value: '9:16', label: '竖屏' },
    { value: '1:1', label: '方形' }
]

const IMAGE_MODELS = new Set<ImageModel>(['banana', 'doubao', 'qwen-image-3.0-pro', 'gemini-3.1-flash-image', 'seedream-5-0-lite'])
const VIDEO_MODELS = new Set<VideoModel>(['seedance', 'seedance25', 'wan3', 'wan3prime', 'seedance-2.0-global', 'seedance-2.5-global', 'MiniMax-H3'])

function ratioShapeClass(ratio: AspectRatio) {
    if (ratio === '21:9') return 'h-3 w-7'
    if (ratio === '16:9') return 'h-3.5 w-6'
    if (ratio === '9:16') return 'h-6 w-3.5'
    if (ratio === '4:3') return 'h-4.5 w-6'
    if (ratio === '3:4') return 'h-6 w-4.5'
    return 'h-5 w-5'
}

async function readJsonResponse(response: Response) {
    const text = await response.text()
    try {
        return JSON.parse(text)
    } catch {
        const fallback = text.trim().slice(0, 240)
        throw new Error(response.status === 504 ? '生成服务响应超时，请稍后重试' : fallback || `请求失败（HTTP ${response.status}）`)
    }
}

function readBrowserVideoDuration(file: File): Promise<number | null> {
    return new Promise(resolve => {
        const video = document.createElement('video')
        const objectUrl = URL.createObjectURL(file)
        let settled = false
        const finish = (duration: number | null) => {
            if (settled) return
            settled = true
            window.clearTimeout(timeout)
            video.removeAttribute('src')
            video.load()
            URL.revokeObjectURL(objectUrl)
            resolve(duration)
        }
        const timeout = window.setTimeout(() => finish(null), 10_000)
        video.preload = 'metadata'
        video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null)
        video.onerror = () => finish(null)
        video.src = objectUrl
    })
}

export default function CreatorWorkspace({ mode }: { mode: Mode }) {
    const router = useRouter()
    const { locale, t } = useI18n()
    const product = CREATION_PRODUCTS[mode]
    const formSectionRef = useRef<HTMLElement>(null)
    const [settingsPanel, setSettingsPanel] = useState<'ratios' | 'references' | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)
    const referenceVideoInputRef = useRef<HTMLInputElement>(null)
    const coverFileRef = useRef<HTMLInputElement>(null)
    const providerSwitchToastJobIds = useRef<Set<string>>(new Set())
    const { userId, signingIn, requireAuth } = useCreationAuth()
    const [prompt, setPrompt] = useCreatorState(mode, 'prompt')
    const [ratios, setRatios] = useCreatorState(mode, 'ratios')
    const previewRatio = ratios[0] ?? (mode === 'image' ? '1:1' : '16:9')
    const [previewWidth, previewHeight] = previewRatio.split(':').map(Number)
    const [imageModel, setImageModel] = useCreatorState(mode, 'imageModel')
    const [videoModel, setVideoModel] = useCreatorState(mode, 'videoModel')
    const [duration, setDuration] = useCreatorState(mode, 'duration')
    const videoDurationOptions = useMemo(() => {
        const capability = getVideoProviderCapability(videoModel)
        if (!capability) return [5]
        if (capability.duration.values?.length) return [...capability.duration.values]
        return [4, 5, 6, 8, 10, 12, 15, 18, 20, 24, 30].filter(value => value >= capability.duration.min && value <= capability.duration.max)
    }, [videoModel])
    const [files, setFiles] = useCreatorState(mode, 'files')
    const [referenceAsset, setReferenceAsset] = useCreatorState(mode, 'referenceAsset')
    const [referenceVideos, setReferenceVideos] = useCreatorState(mode, 'referenceVideos')
    const [uploadingReferenceVideos, setUploadingReferenceVideos] = useCreatorState(mode, 'uploadingReferenceVideos')
    const [deletingReferenceVideoId, setDeletingReferenceVideoId] = useCreatorState(mode, 'deletingReferenceVideoId')
    const [uploadedPreviews, setUploadedPreviews] = useState<Array<{ file: File; url: string }>>([])
    const savedImageAsset = referenceAsset?.type === 'image' ? referenceAsset : null
    const savedVideoAsset = referenceAsset?.type === 'video' ? referenceAsset : null
    const savedPreview = savedImageAsset?.url
    const referenceImageCount = files.length + (savedImageAsset ? 1 : 0)
    const referenceVideoCount = referenceVideos.length + (savedVideoAsset ? 1 : 0)
    const referenceVideoDurationInputs = [...(savedVideoAsset ? [{ name: `video-${savedVideoAsset.id}.mp4`, durationSeconds: savedVideoAsset.duration ?? 0 }] : []), ...referenceVideos]
    const previews = [...(savedPreview ? [{ url: savedPreview, file: null }] : []), ...uploadedPreviews]
    const searchParams = useSearchParams()
    const requestedAssetId = searchParams.get('assetId')
    const requestedReuse = searchParams.get('reuse') === '1'
    const [resultUrl, setResultUrl] = useCreatorState(mode, 'resultUrl')
    const [resultAsset, setResultAsset] = useCreatorState(mode, 'resultAsset')
    const [resultAssets, setResultAssets] = useCreatorState(mode, 'resultAssets')
    const [loading, setLoading] = useCreatorState(mode, 'loading')
    const [generationProgress, setGenerationProgress] = useCreatorState(mode, 'generationProgress')
    const [error, setError] = useCreatorState(mode, 'error')
    const [assets, setAssets] = useCreatorState(mode, 'assets')
    const [assetsLoading, setAssetsLoading] = useCreatorState(mode, 'assetsLoading')
    const [assetFilter, setAssetFilter] = useCreatorState(mode, 'assetFilter')
    const [nextCursor, setNextCursor] = useCreatorState(mode, 'nextCursor')
    const [galleryError, setGalleryError] = useCreatorState(mode, 'galleryError')
    const [coverTargetId, setCoverTargetId] = useCreatorState(mode, 'coverTargetId')
    const [coverUpdating, setCoverUpdating] = useCreatorState(mode, 'coverUpdating')
    const [deletingAssetIds, setDeletingAssetIds] = useCreatorState(mode, 'deletingAssetIds')
    const [selectingAssets, setSelectingAssets] = useCreatorState(mode, 'selectingAssets')
    const [selectedAssetIds, setSelectedAssetIds] = useCreatorState(mode, 'selectedAssetIds')
    const removeAssetsFromSessions = useRemoveCreatorAssets()
    const deletingAssets = deletingAssetIds.length > 0
    const selectedAssetIdSet = new Set(selectedAssetIds)
    const selectedAssets = assets.filter(asset => selectedAssetIdSet.has(asset.id))
    const allLoadedAssetsSelected = assets.length > 0 && selectedAssets.length === assets.length
    const { confirm, confirmDialog } = useConfirmDialog()
    const selectedVideoCapability = getVideoProviderCapability(videoModel)
    const ratioOptions = mode === 'image' ? IMAGE_RATIO_OPTIONS : isHiModelsH3Provider(videoModel) ? VIDEO_RATIO_OPTIONS : VIDEO_RATIO_OPTIONS.filter(option => option.value !== '21:9')
    const imageReferenceLimit =
        mode === 'video' ? (selectedVideoCapability?.maxImageReferences ?? 0) : getImageProviderCapability(imageModel)?.maxImageReferences || getImageProviderCapability('banana')!.maxImageReferences
    const requestedReferenceCount = referenceImageCount + (mode === 'image' && referenceVideoCount > 0 ? 1 : 0)
    const referenceImageError =
        validateCreatorReferenceImages(files, savedImageAsset ? 1 : 0) ?? (requestedReferenceCount > imageReferenceLimit ? creatorReferenceLimitMessage(imageReferenceLimit) : null)
    const referenceVideoLimit = mode === 'image' ? MAX_IMAGE_REFERENCE_VIDEOS : Math.min(MAX_STORYBOARD_REFERENCE_VIDEOS, selectedVideoCapability?.maxVideoReferences ?? 0)
    const referenceVideoLimitReached = referenceVideoLimit > 0 && referenceVideoCount >= referenceVideoLimit
    const referenceVideoDurationRule = mode === 'video' ? selectedVideoCapability?.referenceVideoDuration : null
    const referenceVideoDurationViolation = getReferenceVideoDurationViolation(referenceVideoDurationInputs, referenceVideoDurationRule)
    const referenceVideoCountError =
        referenceVideoCount > referenceVideoLimit
            ? referenceVideoLimit === 0
                ? `${selectedVideoCapability?.label ?? videoModel} 不支持视频作为参考素材`
                : t('最多上传 {count} 个参考视频').replace('{count}', String(referenceVideoLimit))
            : null

    const loadAssets = useCallback(
        async (filter: AssetFilter, cursor?: string) => {
            if (!isLoggedIn()) return
            const requestedUserId = getAuthUser()?.userId
            setAssetsLoading(true)
            setGalleryError(null)
            try {
                const query = new URLSearchParams({ limit: '24' })
                if (filter !== 'all') query.set('type', filter)
                if (cursor) query.set('cursor', cursor)
                const response = await clientFetch(`/api/create/assets?${query}`, { timeoutMs: 20_000 })
                const json = await readJsonResponse(response)
                if (!json.success) throw new Error(json.error ?? '作品加载失败')
                if (!isLoggedIn() || getAuthUser()?.userId !== requestedUserId) return
                setAssets(current => (cursor ? [...current, ...json.data.items] : json.data.items))
                setNextCursor(json.data.nextCursor ?? null)
            } catch (assetError) {
                setGalleryError(assetError instanceof Error ? assetError.message : String(assetError))
            } finally {
                setAssetsLoading(false)
            }
        },
        [setAssets, setAssetsLoading, setGalleryError, setNextCursor]
    )

    useEffect(() => {
        const previews = files.map(file => ({ file, url: URL.createObjectURL(file) }))
        // Retained Next routes reconnect effects when shown again. Recreate the
        // browser-owned URLs on each connection instead of reusing revoked URLs.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUploadedPreviews(previews)
        return () => {
            setUploadedPreviews([])
            previews.forEach(preview => URL.revokeObjectURL(preview.url))
        }
    }, [files])

    useEffect(() => {
        if (!userId) return
        const timer = window.setTimeout(() => void loadAssets(assetFilter), 0)
        return () => window.clearTimeout(timer)
    }, [assetFilter, userId, loadAssets])

    function addReferenceImages(selected: FileList | null) {
        const additions = Array.from(selected ?? [])
        if (fileRef.current) fileRef.current.value = ''
        if (!additions.length || loading) return
        const next = [...files, ...additions]
        const validationError = validateCreatorReferenceImages(next, savedImageAsset ? 1 : 0)
        if (validationError) {
            setError(validationError)
            return
        }
        setFiles(next)
        setError(null)
    }

    function toggleRatio(value: AspectRatio) {
        setRatios(current => (current.includes(value) ? (current.length === 1 ? current : current.filter(item => item !== value)) : [...current, value]))
    }

    function addAsset(asset: CreatorAsset) {
        setAssets(current => {
            if (assetFilter !== 'all' && assetFilter !== asset.type) return current
            return [asset, ...current.filter(item => item.id !== asset.id)]
        })
        setResultAssets(current => [asset, ...current.filter(item => item.id !== asset.id)])
        setResultAsset(asset)
        setResultUrl(asset.url)
    }

    const reuseAsset = useCallback(
        (asset: CreatorAsset) => {
            // A reference's media type does not change the selected output mode.
            const availableRatios = mode === 'image' ? IMAGE_RATIO_OPTIONS : asset.provider === 'MiniMax-H3' ? VIDEO_RATIO_OPTIONS : VIDEO_RATIO_OPTIONS.filter(option => option.value !== '21:9')
            const restoredRatio = availableRatios.some(option => option.value === asset.ratio) ? (asset.ratio as AspectRatio) : mode === 'image' ? '1:1' : '16:9'

            setPrompt(asset.prompt ?? '')
            setRatios([restoredRatio])
            setFiles([])
            setReferenceVideos([])
            setReferenceAsset(asset)
            if (mode === 'image' && asset.type === 'image' && asset.provider && IMAGE_MODELS.has(asset.provider as ImageModel)) {
                setImageModel(asset.provider as ImageModel)
            }
            if (mode === 'video' && asset.type === 'video') {
                if (asset.provider && VIDEO_MODELS.has(asset.provider as VideoModel) && isGenerationModelVisible(asset.provider)) {
                    const provider = asset.provider as VideoModel
                    setVideoModel(provider)
                    setDuration(String(normalizeVideoDuration(provider, asset.duration ?? 5)))
                } else {
                    setDuration(String(normalizeVideoDuration(videoModel, asset.duration ?? 5)))
                }
            }
            setResultAsset(asset)
            setResultUrl(asset.url)
            setResultAssets([asset])
            setError(null)
            requestAnimationFrame(() => formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
            pushToast('success', asset.type === 'image' ? '已填充原文案和参考图，可以继续二次创作。' : '已填充原文案和参考视频，可以继续二次创作。')
        },
        [mode, videoModel, setPrompt, setRatios, setFiles, setReferenceVideos, setReferenceAsset, setImageModel, setVideoModel, setDuration, setResultAsset, setResultUrl, setResultAssets, setError]
    )

    useEffect(() => {
        if (!userId || !requestedAssetId) return
        let cancelled = false
        void (async () => {
            try {
                const response = await clientFetch(`/api/create/assets/${encodeURIComponent(requestedAssetId)}`)
                const json = await readJsonResponse(response)
                if (!response.ok || !json.success) throw new Error(json.error ?? '作品加载失败')
                if (cancelled) return
                const asset = json.data as CreatorAsset
                if (requestedReuse) {
                    reuseAsset(asset)
                    router.replace(`/ai${mode}`, { scroll: false })
                    return
                }
                if (asset.type !== mode) {
                    router.replace(`/ai${asset.type}?assetId=${encodeURIComponent(asset.id)}`)
                    return
                }
                setResultAsset(asset)
                setResultAssets([asset])
                setResultUrl(asset.url)
                requestAnimationFrame(() => {
                    if (!cancelled) document.getElementById('creator-result')?.scrollIntoView({ block: 'start' })
                })
            } catch (assetError) {
                if (!cancelled) setError(assetError instanceof Error ? assetError.message : '作品加载失败')
            }
        })()
        return () => {
            cancelled = true
        }
    }, [userId, mode, requestedAssetId, requestedReuse, reuseAsset, router, setResultAsset, setResultAssets, setResultUrl, setError])

    function chooseCover(assetId: string) {
        setCoverTargetId(assetId)
        if (coverFileRef.current) {
            coverFileRef.current.value = ''
            coverFileRef.current.click()
        }
    }

    async function uploadCover(file: File | undefined) {
        if (!file || !coverTargetId) return
        setCoverUpdating(true)
        setGalleryError(null)
        try {
            const form = new FormData()
            form.append('cover', file)
            const response = await clientFetch(`/api/create/assets/${encodeURIComponent(coverTargetId)}/cover`, {
                method: 'POST',
                body: form,
                timeoutMs: 60_000
            })
            const json = await readJsonResponse(response)
            if (!json.success) throw new Error(json.error ?? '封面设置失败')
            const updated = json.data as CreatorAsset
            setAssets(current => current.map(item => (item.id === updated.id ? updated : item)))
            setResultAssets(current => current.map(item => (item.id === updated.id ? updated : item)))
            setResultAsset(current => (current?.id === updated.id ? updated : current))
            setReferenceAsset(current => (current?.id === updated.id ? updated : current))
        } catch (coverError) {
            setGalleryError(coverError instanceof Error ? coverError.message : String(coverError))
        } finally {
            setCoverUpdating(false)
            setCoverTargetId(null)
        }
    }

    function toggleAssetSelection(assetId: string) {
        if (deletingAssets || assetsLoading) return
        setSelectedAssetIds(current => (current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId]))
    }

    async function deleteAssets(assetsToDelete: CreatorAsset[]) {
        if (deletingAssets || !assetsToDelete.length) return
        setDeletingAssetIds(assetsToDelete.map(asset => asset.id))
        setGalleryError(null)
        const failures: string[] = []
        try {
            await runWithConcurrency(assetsToDelete, 3, async asset => {
                try {
                    const response = await clientFetch(`/api/create/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE', timeoutMs: 30_000 })
                    // A missing record has already been removed, including after a timed-out deletion.
                    if (response.status !== 404) {
                        const json = await readJsonResponse(response)
                        if (!response.ok || !json.success) throw new Error(json.error ?? '删除作品失败')
                    }
                    removeAssetsFromSessions([asset.id])
                } catch (deleteError) {
                    failures.push(deleteError instanceof Error ? deleteError.message : String(deleteError))
                }
            })
            const deletedCount = assetsToDelete.length - failures.length
            if (deletedCount > 0) pushToast('success', t('已删除 {count} 条作品').replace('{count}', String(deletedCount)))
            if (failures.length > 0) {
                setGalleryError(assetsToDelete.length === 1 ? failures[0] : t('有 {count} 条作品删除失败，请重试。').replace('{count}', String(failures.length)))
            } else {
                setSelectingAssets(false)
                setSelectedAssetIds([])
            }
        } finally {
            setDeletingAssetIds([])
        }
    }

    async function removeSelectedAssets() {
        if (deletingAssets || assetsLoading || !selectedAssets.length) return
        const approved = await confirm({
            title: t('删除选中的 {count} 条作品？').replace('{count}', String(selectedAssets.length)),
            eyebrow: t('危险操作'),
            message: t('所选作品将从“我的作品”中永久移除，删除后无法恢复。'),
            confirmText: t('永久删除'),
            tone: 'danger'
        })
        if (approved) await deleteAssets(selectedAssets)
    }

    async function removeAsset(asset: CreatorAsset) {
        if (deletingAssets) return
        const assetType = asset.type === 'video' ? '视频' : '图片'
        const previewUrl = asset.type === 'image' ? asset.url : asset.coverUrl
        const approved = await confirm({
            title: t('删除这条{type}作品？').replace('{type}', t(assetType)),
            eyebrow: t('危险操作'),
            message: (
                <div className="flex items-center gap-3">
                    <div className="flex h-16 w-24 flex-none items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                        {previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={previewUrl}
                                alt={t('作品预览')}
                                className="h-full w-full object-cover"
                            />
                        ) : asset.type === 'video' ? (
                            <Video className="h-5 w-5 text-slate-500" />
                        ) : (
                            <ImageIcon className="h-5 w-5 text-slate-500" />
                        )}
                    </div>
                    <div className="min-w-0">
                        <p className="font-medium text-red-100">{t('删除后无法恢复')}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-red-200/65">{asset.prompt || t('这条作品将从“我的作品”中永久移除。')}</p>
                    </div>
                </div>
            ),
            confirmText: t('永久删除'),
            tone: 'danger'
        })
        if (approved) await deleteAssets([asset])
    }

    async function uploadReferenceVideos(files: FileList | null) {
        if (!files?.length || uploadingReferenceVideos || deletingReferenceVideoId || loading) return
        const selected = Array.from(files)
        if (referenceVideoInputRef.current) referenceVideoInputRef.current.value = ''
        if (referenceVideoLimit === 0) {
            setError(`${selectedVideoCapability?.label ?? videoModel} 不支持视频作为参考素材`)
            return
        }
        const remaining = referenceVideoLimit - referenceVideoCount
        if (selected.length > remaining) {
            setError(t('最多上传 {count} 个参考视频').replace('{count}', String(referenceVideoLimit)))
            return
        }
        const invalid = selected.find(item => !resolveReferenceVideoMimeType(item.type, item.name) || item.size > MAX_REFERENCE_VIDEO_BYTES)
        if (invalid) {
            setError(invalid.size > MAX_REFERENCE_VIDEO_BYTES ? `${invalid.name} 超过 300MB` : `${invalid.name} 不是支持的 MP4、MOV 或 WebM 视频`)
            return
        }

        setUploadingReferenceVideos(true)
        setError(null)
        try {
            if (!(await requireAuth())) return
            const selectedDurations = referenceVideoDurationRule ? await Promise.all(selected.map(readBrowserVideoDuration)) : []
            const candidates = selected.flatMap((item, index) => {
                const durationSeconds = selectedDurations[index]
                return durationSeconds == null ? [] : [{ name: item.name, durationSeconds }]
            })
            const pendingViolation = getReferenceVideoDurationViolation([...referenceVideoDurationInputs, ...candidates], referenceVideoDurationRule)
            if (pendingViolation) throw new Error(formatReferenceVideoDurationViolation(selectedVideoCapability?.label ?? videoModel, pendingViolation))

            let latest = referenceVideos
            for (const item of selected) {
                const form = new FormData()
                form.set('mode', mode)
                form.set('provider', videoModel)
                form.set('file', item)
                const response = await clientFetch('/api/create/reference-videos', { method: 'POST', body: form, timeoutMs: 10 * 60_000 })
                const json = await readJsonResponse(response)
                if (!response.ok || !json.success) throw new Error(json.error ?? '参考视频上传失败')
                const uploaded = parseStoryboardReferenceVideos([json.data?.referenceVideo])[0]
                if (!uploaded) throw new Error('参考视频上传失败')
                latest = [...latest, uploaded]
                setReferenceVideos(latest)
            }
            pushToast('success', `已上传 ${selected.length} 个参考视频`)
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : '参考视频上传失败')
        } finally {
            setUploadingReferenceVideos(false)
        }
    }

    async function deleteReferenceVideo(video: StoryboardReferenceVideo) {
        if (deletingReferenceVideoId || uploadingReferenceVideos || loading) return
        setDeletingReferenceVideoId(video.id)
        setError(null)
        try {
            const response = await clientFetch('/api/create/reference-videos', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: video.url }),
                timeoutMs: 30_000
            })
            const json = await readJsonResponse(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '参考视频删除失败')
            setReferenceVideos(current => current.filter(item => item.id !== video.id))
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : '参考视频删除失败')
        } finally {
            setDeletingReferenceVideoId(null)
        }
    }

    async function generate() {
        if (loading || uploadingReferenceVideos || deletingReferenceVideoId) return
        if (referenceImageError) {
            setError(referenceImageError)
            return
        }
        if (!prompt.trim()) {
            setError('先描述一下你想生成的画面')
            return
        }
        if (ratios.length === 0) {
            setError('请至少选择一个画面比例')
            return
        }
        if (referenceVideoCountError) {
            setError(referenceVideoCountError)
            return
        }
        if (mode === 'video' && referenceVideoDurationViolation) {
            setError(formatReferenceVideoDurationViolation(selectedVideoCapability?.label ?? videoModel, referenceVideoDurationViolation))
            return
        }
        setLoading(true)
        setError(null)
        try {
            if (!(await requireAuth())) {
                setLoading(false)
                return
            }
        } catch (authError) {
            setError(authError instanceof Error ? authError.message : '登录失败，请重试')
            setLoading(false)
            return
        }
        setResultUrl(null)
        setResultAsset(null)
        setResultAssets([])
        const selectedRatios = [...ratios]

        const generationMode = mode
        const selectedImageModel = imageModel
        const selectedVideoModel = videoModel
        const selectedDuration = duration
        setGenerationProgress({ done: 0, total: selectedRatios.length })

        const createForm = (selectedRatio: AspectRatio) => {
            const form = new FormData()
            form.append('prompt', prompt.trim())
            form.append('ratio', selectedRatio)
            form.append('provider', generationMode === 'image' ? selectedImageModel : selectedVideoModel)
            if (referenceAsset?.type === 'image') form.append('referenceAssetId', referenceAsset.id)
            if (referenceAsset?.type === 'video') form.append('referenceVideoAssetId', referenceAsset.id)
            for (const file of files) form.append('image', file)
            form.append('referenceVideos', JSON.stringify(referenceVideos))
            return form
        }

        const generateImage = async (selectedRatio: AspectRatio) => {
            const response = await clientFetch('/api/create/image', { method: 'POST', body: createForm(selectedRatio), timeoutMs: 55_000 })
            const json = await readJsonResponse(response)
            if (!json.success) throw new Error(json.error ?? '图片生成失败')
            const deadline = Date.now() + 10 * 60 * 1000
            let statusAttempt = 0
            while (Date.now() < deadline) {
                const baseMs = [3_000, 5_000, 8_000, 12_000, 15_000][Math.min(statusAttempt++, 4)]
                await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs })))
                const statusResponse = await clientFetch(`/api/create/image/status/${encodeURIComponent(json.data.jobId)}`, { timeoutMs: 20_000 })
                const statusJson = await readJsonResponse(statusResponse)
                if (!statusJson.success) throw new Error(statusJson.error ?? '图片状态查询失败')
                const providerSwitch = (statusJson.data.providerSwitch ?? statusJson.data.result?.providerSwitch) as ImageProviderSwitch | undefined
                if (providerSwitch?.status === 429 && !providerSwitchToastJobIds.current.has(json.data.jobId)) {
                    providerSwitchToastJobIds.current.add(json.data.jobId)
                    pushToast(
                        'success',
                        `“${selectedRatio} 图片”连续 ${providerSwitch.attempts ?? 3} 次触发 429，已从 ${IMAGE_MODEL_LABELS[providerSwitch.from] ?? providerSwitch.from} 切换至 ${IMAGE_MODEL_LABELS[providerSwitch.to] ?? providerSwitch.to}`
                    )
                }
                if (statusJson.data.phase === 'done') {
                    if (statusJson.data.result.asset) addAsset(statusJson.data.result.asset)
                    else setResultUrl(statusJson.data.result.url)
                    return
                }
                if (statusJson.data.phase === 'error') throw new Error(statusJson.data.error ?? '图片生成失败')
            }
            throw new Error('图片生成超时，请稍后重试')
        }

        const generateVideo = async (selectedRatio: AspectRatio) => {
            const form = createForm(selectedRatio)
            form.append('duration', selectedDuration)
            const response = await clientFetch('/api/create/video', { method: 'POST', body: form, timeoutMs: 65_000 })
            const json = await readJsonResponse(response)
            if (!json.success) throw new Error(json.error ?? '视频任务创建失败')
            let providerTaskId = ''
            const creationDeadline = Date.now() + 2 * 60 * 1000
            let creationAttempt = 0
            while (Date.now() < creationDeadline) {
                const baseMs = [3_000, 5_000, 8_000, 10_000][Math.min(creationAttempt++, 3)]
                await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs })))
                const jobResponse = await clientFetch(`/api/create/video/job/${encodeURIComponent(json.data.jobId)}`, { timeoutMs: 20_000 })
                const jobJson = await readJsonResponse(jobResponse)
                if (!jobJson.success) throw new Error(jobJson.error ?? '视频任务创建失败')
                if (jobJson.data.result?.taskId) {
                    providerTaskId = jobJson.data.result.taskId
                    break
                }
                if (jobJson.data.phase === 'error') throw new Error(jobJson.data.error ?? '视频任务创建失败')
            }
            if (!providerTaskId) throw new Error('视频任务创建超时，请稍后重试')
            const deadline = Date.now() + 15 * 60 * 1000
            let statusAttempt = 0
            while (Date.now() < deadline) {
                const baseMs = [8_000, 10_000, 15_000, 20_000, 30_000][Math.min(statusAttempt++, 4)]
                await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs })))
                const statusResponse = await clientFetch(
                    `/api/create/video/status?provider=${selectedVideoModel}&taskId=${encodeURIComponent(providerTaskId)}&jobId=${encodeURIComponent(json.data.jobId)}`,
                    { timeoutMs: 180_000 }
                )
                const statusJson = await readJsonResponse(statusResponse)
                if (!statusJson.success) throw new Error(statusJson.error ?? '视频状态查询失败')
                if (statusJson.data.status === 'completed') {
                    if (statusJson.data.asset) addAsset(statusJson.data.asset)
                    else setResultUrl(statusJson.data.url)
                    return
                }
                if (statusJson.data.status === 'failed') {
                    throw new Error(statusJson.data.error ?? '视频生成失败')
                }
            }
            throw new Error('视频仍在生成，请稍后重试')
        }

        try {
            const failures: string[] = []
            // Image requests are admitted by the account limit and isolated
            // provider pools on the server. Submit all selected ratios without
            // adding another browser-side queue; videos stay serial because
            // each provider status request can be long-lived.
            await runWithConcurrency(selectedRatios, generationMode === 'image' ? selectedRatios.length : 1, async selectedRatio => {
                try {
                    await (generationMode === 'image' ? generateImage(selectedRatio) : generateVideo(selectedRatio))
                } catch (generationError) {
                    const message = generationError instanceof Error ? generationError.message : String(generationError)
                    failures.push(`${selectedRatio}：${message}`)
                } finally {
                    setGenerationProgress(current => ({ ...current, done: current.done + 1 }))
                }
            })

            if (failures.length > 0) setError(`${selectedRatios.length - failures.length}/${selectedRatios.length} 个比例生成成功；${failures.join('；')}`)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="studio-theme studio-create flex min-h-screen flex-col">
            <SiteHeader
                sticky
                className="z-30"
                contentClassName="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:gap-x-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div className="order-1 flex min-w-0 items-center gap-1.5 sm:gap-3">
                    <HomeLogoLink />
                    {userId && (
                        <Link
                            href="/projects"
                            aria-label={t('返回项目')}
                            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white sm:p-2">
                            <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
                        </Link>
                    )}
                    <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2 font-semibold">
                            <Sparkles className="hidden h-4 w-4 shrink-0 text-violet-400 sm:block" />
                            <span
                                className="truncate"
                                title={t(product.title)}>
                                {t(mode === 'image' ? 'AI 图片' : 'AI 视频')}
                            </span>
                        </p>
                    </div>
                </div>
                <CreationModeNav mode={mode} />
                <div className="order-2 flex items-center justify-self-end gap-2 lg:order-3">
                    {userId && (
                        <WalletBalance
                            key={userId}
                            userId={userId}
                            compact
                        />
                    )}
                    <div className="hidden sm:block">
                        <AuthBar variant="default" />
                    </div>
                    <div className="sm:hidden [&_[role=menu]]:end-0 [&_[role=menu]]:start-auto">
                        <AuthBar variant="compact" />
                    </div>
                </div>
            </SiteHeader>

            <main className={styles.main}>
                <div className={styles.intro}>
                    <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t(product.title)}</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{t(product.description)}</p>
                </div>
                <div className={styles.workspace}>
                    <div className={styles.entry}>
                        <section
                            ref={formSectionRef}
                            className={styles.composer}
                            aria-label={t(product.title)}>
                            <div className={styles.composerHeading}>
                                <label htmlFor="create-prompt">
                                    <Sparkles size={16} />
                                    {t('画面描述')}
                                </label>
                                <span className="tabular-nums">{prompt.length}/4000</span>
                            </div>
                            <textarea
                                id="create-prompt"
                                value={prompt}
                                onChange={event => setPrompt(event.target.value)}
                                maxLength={4000}
                                rows={5}
                                placeholder={t(mode === 'image' ? '描述主体、场景、构图、光线与风格…' : '描述场景、人物动作、镜头运动与氛围…')}
                                className={styles.prompt}
                            />
                            {(previews.length > 0 || referenceVideoCount > 0) && (
                                <div className={styles.attachments}>
                                    {previews.map((preview, index) => (
                                        <button
                                            key={preview.url}
                                            type="button"
                                            onClick={() => setSettingsPanel('references')}
                                            aria-label={`${t('参考图预览')} ${index + 1}`}
                                            className={styles.attachment}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={preview.url}
                                                alt=""
                                            />
                                        </button>
                                    ))}
                                    {referenceVideoCount > 0 && (
                                        <button
                                            type="button"
                                            className={styles.optionButton}
                                            onClick={() => setSettingsPanel('references')}>
                                            <Video size={16} />
                                            {t('参考视频')} · {referenceVideoCount}
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className={styles.toolbar}>
                                <div className={styles.options}>
                                    {mode === 'image' ? (
                                        <CustomSelect
                                            value={imageModel}
                                            onChange={value => {
                                                setImageModel(value as ImageModel)
                                            }}
                                            ariaLabel="选择图片生成模型"
                                            className={styles.modelSelect}
                                            buttonClassName={styles.selectButton}
                                            disabled={loading}
                                            options={[
                                                { value: 'banana', label: 'Nano Banana', description: '支持文生图和参考图，适合保持人物与风格一致' },
                                                { value: 'qwen-image-3.0-pro', label: 'Qwen-Image-3.0-Pro', description: '阿里百炼图片模型，支持文生图和参考图' },
                                                { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', description: 'Himodels Gemini Flash，支持参考图' },
                                                { value: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite', description: 'Himodels Seedream 5.0 Lite，2K 文生图' }
                                            ]}
                                        />
                                    ) : (
                                        <CustomSelect
                                            value={videoModel}
                                            onChange={value => {
                                                const next = value as VideoModel

                                                setVideoModel(next)
                                                setDuration(String(normalizeVideoDuration(next, Number(duration))))
                                                if (!isHiModelsH3Provider(next)) {
                                                    setRatios(current => {
                                                        const supported = current.filter(value => value !== '21:9')
                                                        return supported.length ? supported : ['16:9']
                                                    })
                                                }
                                            }}
                                            ariaLabel="选择视频生成模型"
                                            className={styles.modelSelect}
                                            buttonClassName={styles.selectButton}
                                            disabled={loading}
                                            options={[
                                                { value: 'seedance25', label: SEEDANCE_25_LABEL, description: 'Seedance 2.5，多模态参考与同步原声；支持 4-30 秒逐秒选择' },
                                                { value: 'seedance', label: SEEDANCE_20_LABEL, description: 'Seedance 2.0，支持文生视频、首尾帧与同步原声；时长 4/5/6/8/10/12/15 秒' },
                                                { value: 'wan3', label: 'Wan 3.0', description: '阿里百炼 Wan 3.0，多模态参考、最长 30 秒' },
                                                { value: 'wan3prime', label: WAN_3_PRIME_LABEL, description: '阿里百炼 Wan 3.0 Prime，1080P、最长 30 秒、生成速度更快' },
                                                { value: 'seedance-2.0-global', label: 'Seedance 2.0 Global', description: 'Himodels Seedance 2.0 文生视频' },
                                                { value: 'seedance-2.5-global', label: 'Seedance 2.5 Global', description: 'Himodels Seedance 2.5 文生视频' },
                                                { value: 'MiniMax-H3', label: 'MiniMax H3', description: 'Himodels 全模态参考、原生音频与多镜头，最高 2K / 15 秒' }
                                            ]}
                                        />
                                    )}
                                    <button
                                        type="button"
                                        className={styles.optionButton}
                                        onClick={() => setSettingsPanel('ratios')}
                                        aria-haspopup="dialog"
                                        aria-expanded={settingsPanel === 'ratios'}
                                        aria-controls="creator-options"
                                        aria-label={`${t('选择画面比例（可多选）')}：${ratios.join(' / ')}`}>
                                        <RectangleHorizontal size={16} />
                                        <span>
                                            {ratios.length ? previewRatio : t('画面比例')}
                                            {ratios.length > 1 ? ` +${ratios.length - 1}` : ''}
                                        </span>
                                        <ChevronDown size={13} />
                                    </button>
                                    {mode === 'video' && (
                                        <CustomSelect
                                            value={duration}
                                            onChange={setDuration}
                                            ariaLabel="选择视频时长"
                                            className={styles.durationSelect}
                                            buttonClassName={styles.selectButton}
                                            disabled={loading}
                                            options={videoDurationOptions.map(value => ({ value: String(value), label: t('{seconds} 秒', { seconds: value }) }))}
                                        />
                                    )}
                                    <button
                                        type="button"
                                        className={styles.optionButton}
                                        onClick={() => setSettingsPanel('references')}
                                        aria-haspopup="dialog"
                                        aria-expanded={settingsPanel === 'references'}
                                        aria-controls="creator-options">
                                        <Paperclip size={16} />
                                        <span>
                                            {t('参考素材')}
                                            {referenceImageCount + referenceVideoCount > 0 ? ` · ${referenceImageCount + referenceVideoCount}` : ''}
                                        </span>
                                    </button>
                                </div>
                                <button
                                    disabled={
                                        loading ||
                                        uploadingReferenceVideos ||
                                        !!deletingReferenceVideoId ||
                                        !prompt.trim() ||
                                        ratios.length === 0 ||
                                        !!referenceImageError ||
                                        !!referenceVideoCountError ||
                                        !!referenceVideoDurationViolation
                                    }
                                    onClick={generate}
                                    type="button"
                                    className={styles.generateButton}>
                                    {signingIn ? (
                                        <>
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            {t('登录中...')}
                                        </>
                                    ) : loading ? (
                                        <>
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            {t('正在生成')} {generationProgress.done}/{generationProgress.total}
                                        </>
                                    ) : (
                                        <>
                                            <ArrowUp className="h-5 w-5" />
                                            {t(mode === 'image' ? '生成图片' : '生成视频')}
                                            {ratios.length > 1 ? `（${ratios.length} 个比例）` : ''}
                                        </>
                                    )}
                                </button>
                            </div>
                            <div
                                className={styles.notices}
                                aria-live="polite">
                                {(referenceImageCount > 0 || referenceVideoCount > 0) &&
                                    mode === 'image' &&
                                    (imageModel === 'doubao' || (isHiModelsImageModel(imageModel) && imageModel.startsWith('seedream-'))) && (
                                        <p>{t('当前所选模型不读取参考素材，本次任务会自动切换至 Nano Banana；移除参考图片和视频即可使用所选模型。')}</p>
                                    )}
                                {mode === 'video' && referenceImageCount > 0 && getVideoProviderCapability(videoModel)?.maxImageReferences === 0 && (
                                    <p>
                                        {selectedVideoCapability?.label}
                                        {t('当前仅支持文字生成视频，请先移除参考图。')}
                                    </p>
                                )}
                                {mode === 'video' && referenceVideoCount > 0 && referenceVideoLimit === 0 && (
                                    <p>
                                        {selectedVideoCapability?.label ?? videoModel}
                                        {t('不支持视频作为参考素材，请删除参考视频或更换模型。')}
                                    </p>
                                )}
                                {referenceImageError && <p>{t(referenceImageError)}</p>}
                                {referenceVideoCountError && <p>{referenceVideoCountError}</p>}
                                {referenceVideoDurationViolation && <p>{formatReferenceVideoDurationViolation(selectedVideoCapability?.label ?? videoModel, referenceVideoDurationViolation)}</p>}
                                {error && <p role="alert">{error}</p>}
                            </div>
                        </section>
                        <div className={styles.examples}>
                            {EXAMPLES[mode].map(example => (
                                <button
                                    key={example}
                                    type="button"
                                    title={t(example)}
                                    onClick={() => setPrompt(example)}>
                                    <Plus size={13} />
                                    <span>{t(example)}</span>
                                </button>
                            ))}
                        </div>
                        {settingsPanel && (
                            <DramaSettingsDialog
                                id="creator-options"
                                title={settingsPanel === 'ratios' ? '画面比例' : '参考素材'}
                                onClose={() => setSettingsPanel(null)}
                                className={`studio-theme studio-create ${styles.optionsDialog}`}>
                                <div className={styles.dialogContent}>
                                    {settingsPanel === 'ratios' ? (
                                        <div>
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <span className="text-sm font-medium text-slate-200">{t('画面比例')}</span>
                                                <span className="text-xs text-slate-600">
                                                    {t('可多选 · 已选')} {ratios.length}
                                                    {t('个')}
                                                </span>
                                            </div>
                                            <div
                                                className={`studio-create-ratios grid gap-2 ${mode === 'image' ? 'grid-cols-5' : ratioOptions.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}
                                                role="group"
                                                aria-label={t('选择画面比例（可多选）')}>
                                                {ratioOptions.map(option => {
                                                    const selected = ratios.includes(option.value)
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            aria-pressed={selected}

                                                            onClick={() => toggleRatio(option.value)}
                                                            className={`relative flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-xl border px-1.5 py-2 text-center transition ${
                                                                selected
                                                                    ? 'border-violet-400/60 bg-violet-500/10 text-violet-200'
                                                                    : 'border-white/[0.08] bg-black/10 text-slate-400 hover:border-violet-400/35 hover:text-slate-200'
                                                            }`}>
                                                            <span
                                                                className="flex h-6 items-center justify-center"
                                                                aria-hidden="true">
                                                                <span
                                                                    className={`block rounded-[3px] border ${ratioShapeClass(option.value)} ${selected ? 'border-violet-300 bg-violet-400/15' : 'border-slate-500'}`}
                                                                />
                                                            </span>
                                                            <span>
                                                                <span className="block text-xs font-semibold">{option.value}</span>
                                                                <span className="sr-only">{t(option.label)}</span>
                                                            </span>
                                                            {selected && <span className="absolute right-2 top-1.5 text-xs font-bold text-violet-300">✓</span>}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                                                        {t('参考图片')} <span className="studio-create-optional">{t('可选')}</span>
                                                    </div>
                                                    <span className="text-xs tabular-nums text-slate-500">
                                                        {referenceImageCount}/{MAX_CREATOR_REFERENCE_IMAGES}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {previews.map((preview, index) => (
                                                        <div
                                                            key={preview.url}
                                                            className="relative h-24 overflow-hidden rounded-xl border border-violet-400/25 bg-black/30">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={preview.url}
                                                                alt={`${t('参考图预览')} ${index + 1}`}
                                                                className="h-full w-full object-contain"
                                                            />
                                                            {!preview.file && (
                                                                <span className="absolute bottom-1 inset-x-1 rounded bg-violet-600/90 px-1 py-1 text-center text-[10px] text-white">
                                                                    {t('来自“我的作品”')}
                                                                </span>
                                                            )}
                                                            <button
                                                                type="button"
                                                                disabled={loading}
                                                                onClick={() => {
                                                                    if (preview.file) setFiles(current => current.filter(file => file !== preview.file))
                                                                    else setReferenceAsset(null)
                                                                    setError(null)
                                                                }}
                                                                aria-label={`${t('移除参考图')} ${index + 1}`}
                                                                className="absolute right-1 top-1 rounded-full bg-black/70 p-1.5 text-white backdrop-blur disabled:opacity-50">
                                                                <X className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {referenceImageCount < MAX_CREATOR_REFERENCE_IMAGES && (
                                                        <button
                                                            type="button"
                                                            disabled={loading}

                                                            onClick={() => fileRef.current?.click()}
                                                            aria-describedby="creator-reference-image-hint"
                                                            className={`studio-create-upload flex items-center justify-center gap-3 rounded-xl border border-dashed p-3 transition disabled:opacity-50 ${referenceImageCount === 0 ? 'col-span-3 min-h-[72px]' : 'h-24 flex-col'}`}>
                                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300">
                                                                <Plus className="h-5 w-5" />
                                                            </span>
                                                            <span className={referenceImageCount === 0 ? 'text-start' : 'text-center'}>
                                                                <span className="block text-xs font-medium text-slate-300">{t('点击上传参考图')}</span>
                                                                {referenceImageCount === 0 && <span className="mt-1 block text-xs text-slate-500">{t('JPG / PNG / WebP，最大 10MB')}</span>}
                                                            </span>
                                                        </button>
                                                    )}
                                                </div>
                                                <p
                                                    id="creator-reference-image-hint"
                                                    className="mt-2 text-xs text-slate-500">
                                                    {t('最多上传 3 张参考图片')}
                                                </p>
                                                <p className="sr-only">{t(mode === 'image' ? '用于保持人物、构图或风格一致' : '作为视频起始画面')}</p>
                                                <input
                                                    ref={fileRef}
                                                    type="file"
                                                    multiple
                                                    accept="image/jpeg,image/png,image/webp"
                                                    className="hidden"
                                                    onChange={event => addReferenceImages(event.target.files)}
                                                />
                                            </div>

                                            <details
                                                className="studio-create-video-reference mt-3"
                                                open={referenceVideoCount > 0 || uploadingReferenceVideos}>
                                                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300">
                                                    <Video className="h-4 w-4 text-slate-500" />
                                                    <span className="font-medium">{t('参考视频')}</span>
                                                    <span className="studio-create-optional">{t('可选')}</span>
                                                    <span className="ms-auto text-xs tabular-nums text-slate-500">
                                                        {referenceVideoCount}/{referenceVideoLimit}
                                                    </span>
                                                    <ChevronDown className="studio-create-disclosure h-4 w-4 text-slate-500" />
                                                </summary>
                                                <div className="px-3 pb-3">
                                                    <p className="mb-3 text-xs leading-5 text-slate-500">
                                                        {t('可上传 MP4、MOV、WebM，最多')} {referenceVideoLimit} {t('个，每个不超过 300MB')}
                                                    </p>
                                                    <input
                                                        ref={referenceVideoInputRef}
                                                        type="file"
                                                        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                                                        multiple={referenceVideoLimit > 1}
                                                        disabled={uploadingReferenceVideos || !!deletingReferenceVideoId || loading}
                                                        className="hidden"
                                                        onChange={event => void uploadReferenceVideos(event.currentTarget.files)}
                                                    />
                                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                        {savedVideoAsset && (
                                                            <div className="relative min-w-0 overflow-hidden rounded-xl border border-violet-400/25 bg-black/30 sm:col-span-3">
                                                                <video
                                                                    src={savedVideoAsset.url}
                                                                    poster={savedVideoAsset.coverUrl ?? undefined}
                                                                    controls
                                                                    muted
                                                                    preload="metadata"
                                                                    playsInline
                                                                    aria-label={t('参考视频')}
                                                                    className="h-40 w-full object-contain"
                                                                />
                                                                <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-slate-300">
                                                                    <span>{t('来自“我的作品”')}</span>
                                                                    {!!savedVideoAsset.duration && <span className="tabular-nums">{savedVideoAsset.duration}s</span>}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    disabled={loading}
                                                                    onClick={() => {
                                                                        setReferenceAsset(null)
                                                                        setError(null)
                                                                    }}
                                                                    aria-label={t('移除参考视频')}
                                                                    className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white backdrop-blur disabled:opacity-50">
                                                                    <X className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {referenceVideos.map((video, index) => (
                                                            <div
                                                                key={video.id}
                                                                className="relative min-w-0 overflow-hidden rounded-xl border border-blue-400/25 bg-black/30 sm:col-span-3">
                                                                <video
                                                                    src={video.url}
                                                                    controls
                                                                    muted
                                                                    preload="metadata"
                                                                    playsInline
                                                                    className="h-40 w-full object-contain"
                                                                />
                                                                <span
                                                                    className="block truncate px-2 py-1 text-xs text-slate-300"
                                                                    title={video.name}>
                                                                    {index + 1 + (savedVideoAsset ? 1 : 0)}. {video.name}
                                                                </span>
                                                                <span className="absolute left-2 top-2 rounded bg-blue-600/90 px-1.5 py-0.5 text-[10px] text-white">
                                                                    {video.durationSeconds.toFixed(1)}s
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void deleteReferenceVideo(video)}
                                                                    disabled={!!deletingReferenceVideoId || uploadingReferenceVideos || loading}
                                                                    aria-label={`删除参考视频 ${video.name}`}
                                                                    className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white backdrop-blur disabled:opacity-50">
                                                                    {deletingReferenceVideoId === video.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                                                </button>
                                                            </div>
                                                        ))}
                                                        {!referenceVideoLimitReached && (
                                                            <button
                                                                type="button"

                                                                onClick={() => referenceVideoInputRef.current?.click()}
                                                                disabled={uploadingReferenceVideos || !!deletingReferenceVideoId || loading || referenceVideoLimit === 0}
                                                                className={`${referenceVideoCount === 0 ? 'sm:col-span-3' : ''} studio-create-upload flex min-h-20 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-3 transition disabled:cursor-not-allowed disabled:opacity-50`}>
                                                                {uploadingReferenceVideos ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                                                                <span className="text-sm font-medium">{uploadingReferenceVideos ? t('上传中...') : t('上传视频')}</span>
                                                                <span className="text-center text-[11px] text-slate-600">
                                                                    MP4 / MOV / WebM · {referenceVideoCount}/{referenceVideoLimit || MAX_STORYBOARD_REFERENCE_VIDEOS}
                                                                </span>
                                                            </button>
                                                        )}
                                                    </div>
                                                    {mode === 'image' && <p className="mt-2 text-xs text-slate-500">{t('将从视频中抽取画面，参考人物、构图和风格生成图片')}</p>}
                                                </div>
                                            </details>
                                            {referenceVideoCountError && <p className="mt-2 text-xs text-amber-300/80">{referenceVideoCountError}</p>}
                                            {referenceImageError && <p className="mt-2 text-xs text-amber-300/80">{t(referenceImageError)}</p>}
                                            {error && (
                                                <p
                                                    role="alert"
                                                    className="mt-2 text-sm text-red-300">
                                                    {error}
                                                </p>
                                            )}
                                            {referenceVideoDurationViolation && (
                                                <p className="mt-2 text-xs text-amber-300/80">
                                                    {formatReferenceVideoDurationViolation(selectedVideoCapability?.label ?? videoModel, referenceVideoDurationViolation)}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </DramaSettingsDialog>
                        )}
                    </div>

                    <section
                        id="creator-result"
                        className={`${styles.results} studio-panel flex min-w-0 flex-col rounded-2xl p-4 sm:p-6`}>
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-400">
                                    {mode === 'image' ? <ImageIcon className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                                </span>
                                <div>
                                    <h2 className="text-base font-semibold">{t('生成结果')}</h2>
                                    <p className="mt-0.5 text-xs text-slate-500">{t('结果生成后会自动保存到我的作品')}</p>
                                </div>
                            </div>
                            {resultUrl && (
                                <div className="flex items-center gap-2">
                                    {resultAsset?.type === 'video' && (
                                        <button
                                            onClick={() => chooseCover(resultAsset.id)}
                                            disabled={coverUpdating}
                                            className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">
                                            <Images className="h-4 w-4" />
                                            {t('设置封面')}
                                        </button>
                                    )}
                                    <a
                                        href={resultUrl}

                                        download
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">
                                        <Download className="h-4 w-4" />
                                        {t('下载')}
                                    </a>
                                </div>
                            )}
                        </div>
                        <div className="studio-create-canvas relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/[0.07]">
                            {resultUrl ? (
                                (resultAsset?.type ?? mode) === 'image' ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={resultUrl}
                                        alt={t('生成结果')}
                                        className="h-full max-h-[640px] min-h-0 w-full object-contain"
                                    />
                                ) : (
                                    <video
                                        src={resultUrl}
                                        poster={resultAsset?.coverUrl ?? undefined}
                                        controls
                                        autoPlay
                                        className="h-full max-h-[640px] min-h-0 w-full object-contain"
                                    />
                                )
                            ) : loading ? (
                                <div
                                    className="px-6 py-12 text-center"
                                    role="status"
                                    aria-live="polite">
                                    <div className="studio-create-loading mx-auto flex h-20 w-20 items-center justify-center rounded-2xl">
                                        <Loader2 className="h-8 w-8 animate-spin text-violet-300" />
                                    </div>
                                    <p className="mt-6 text-base font-medium text-slate-200">{t('AI 正在构思画面')}</p>
                                    {mode === 'video' && <p className="mt-2 text-xs text-slate-500">{t('视频通常需要几分钟')}</p>}
                                </div>
                            ) : (
                                <div className="relative w-full px-6 py-10 text-center">
                                    <div
                                        className="studio-create-frame mx-auto flex items-center justify-center rounded-xl"
                                        style={{
                                            aspectRatio: `${previewWidth} / ${previewHeight}`,
                                            width: `${Math.min(240, (152 * previewWidth) / previewHeight)}px`
                                        }}
                                        aria-hidden="true">
                                        {mode === 'image' ? (
                                            <ImageIcon
                                                className="h-9 w-9 text-violet-300/70"
                                                strokeWidth={1.25}
                                            />
                                        ) : (
                                            <Play
                                                className="h-9 w-9 text-violet-300/70"
                                                strokeWidth={1.25}
                                            />
                                        )}
                                        <span className="absolute inset-x-0 bottom-3 text-[11px] tabular-nums text-violet-300/50">{previewRatio}</span>
                                    </div>
                                    <p className="mt-8 text-base font-medium text-slate-300">{t('生成结果会显示在这里')}</p>
                                    <p className="mt-2 text-xs leading-5 text-slate-500">{t('填写创作内容，生成你的第一份素材')}</p>
                                </div>
                            )}
                        </div>
                        {!resultUrl && (
                            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                                <span>{mode === 'image' ? (IMAGE_MODEL_LABELS[imageModel] ?? imageModel) : (selectedVideoCapability?.label ?? videoModel)}</span>
                                <span
                                    className="h-3 w-px bg-white/10"
                                    aria-hidden="true"
                                />
                                <span className="tabular-nums">{ratios.join(' · ')}</span>
                                {mode === 'video' && (
                                    <span>
                                        {duration} {t('秒')}
                                    </span>
                                )}
                            </div>
                        )}
                        {resultAssets.length > 1 && (
                            <div className="mt-4 grid grid-cols-3 gap-2">
                                {resultAssets.map(asset => (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        onClick={() => {
                                            setResultAsset(asset)
                                            setResultUrl(asset.url)
                                        }}
                                        className={`relative aspect-video overflow-hidden rounded-xl border bg-black/30 transition ${resultAsset?.id === asset.id ? 'border-violet-400' : 'border-white/10 hover:border-violet-400/40'}`}>
                                        {asset.type === 'image' || asset.coverUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={asset.type === 'image' ? asset.url : asset.coverUrl!}
                                                alt={`${asset.ratio ?? ''} 生成结果`}
                                                className="h-full w-full object-contain"
                                            />
                                        ) : (
                                            <video
                                                src={asset.url}
                                                muted
                                                preload="metadata"
                                                className="h-full w-full object-contain"
                                            />
                                        )}
                                        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{asset.ratio ?? '未记录比例'}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                {userId && (
                    <section className="studio-create-library studio-panel mt-6 rounded-2xl p-4 sm:p-6">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Images className="h-5 w-5 text-violet-400" />
                                    <h2 className="font-semibold">{t('我的作品')}</h2>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{t('按生成时间保存，仅展示当前账号的作品')}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectingAssets(!selectingAssets)
                                        setSelectedAssetIds([])
                                    }}
                                    disabled={deletingAssets || assetsLoading || (!selectingAssets && assets.length === 0)}
                                    aria-pressed={selectingAssets}
                                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${selectingAssets ? 'border-violet-400/40 bg-violet-500/15 text-violet-200' : 'border-white/10 text-slate-300 hover:border-violet-400/40 hover:text-white'}`}>
                                    {selectingAssets ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                                    {selectingAssets ? t('取消多选') : t('多选')}
                                </button>
                                <div className="flex rounded-xl bg-black/25 p-1">
                                    {(
                                        [
                                            ['all', '全部'],
                                            ['image', '图片'],
                                            ['video', '视频']
                                        ] as const
                                    ).map(([value, label]) => (
                                        <button
                                            key={value}
                                            onClick={() => {
                                                if (assetFilter === value) return
                                                setSelectedAssetIds([])
                                                setAssets([])
                                                setNextCursor(null)
                                                setAssetFilter(value)
                                            }}
                                            disabled={deletingAssets || assetsLoading}
                                            className={`rounded-lg px-4 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${assetFilter === value ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-white'}`}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {selectingAssets && (
                            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-400/20 bg-violet-500/10 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedAssetIds(allLoadedAssetsSelected ? [] : assets.map(asset => asset.id))}
                                        disabled={deletingAssets || assetsLoading || assets.length === 0}
                                        className="font-medium text-violet-300 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-50">
                                        {allLoadedAssetsSelected ? t('取消全选') : t('全选已加载作品')}
                                    </button>
                                    <span
                                        role="status"
                                        className="text-slate-300">
                                        {t('已选 {count} 条作品').replace('{count}', String(selectedAssets.length))}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void removeSelectedAssets()}
                                    disabled={deletingAssets || assetsLoading || selectedAssets.length === 0}
                                    className="flex items-center gap-1.5 rounded-lg border border-red-400/25 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40">
                                    {deletingAssets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                    {deletingAssets ? t('正在删除…') : t('删除所选（{count}）').replace('{count}', String(selectedAssets.length))}
                                </button>
                            </div>
                        )}

                        {galleryError && <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{galleryError}</div>}
                        {assets.length > 0 ? (
                            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {assets.map(asset => (
                                    <article
                                        key={asset.id}
                                        className={`group overflow-hidden rounded-2xl border bg-[#0d101a] transition hover:border-violet-400/40 hover:shadow-lg hover:shadow-violet-950/20 ${selectingAssets && selectedAssetIdSet.has(asset.id) ? 'border-violet-400' : 'border-white/[0.08]'}`}>
                                        <button
                                            type="button"

                                            onClick={() => (selectingAssets ? toggleAssetSelection(asset.id) : reuseAsset(asset))}
                                            role={selectingAssets ? 'checkbox' : undefined}
                                            aria-checked={selectingAssets ? selectedAssetIdSet.has(asset.id) : undefined}
                                            aria-label={selectingAssets ? t('选择作品：{name}').replace('{name}', asset.prompt || t('未记录提示词')) : undefined}
                                            title={selectingAssets ? undefined : t('二次创作')}
                                            disabled={deletingAssets || (selectingAssets && assetsLoading)}
                                            className="block w-full cursor-pointer text-start focus-visible:outline-none">
                                            <div className="relative aspect-video bg-black/40">
                                                {asset.type === 'image' ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={asset.url}
                                                        alt={asset.prompt ?? '生成图片'}
                                                        className="h-full w-full object-cover"
                                                    />
                                                ) : asset.coverUrl ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={asset.coverUrl}
                                                        alt={t('视频封面')}
                                                        className="h-full w-full object-cover"
                                                    />
                                                ) : (
                                                    <video
                                                        src={asset.url}
                                                        preload="metadata"
                                                        className="h-full w-full object-cover"
                                                    />
                                                )}
                                                <span className="absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] text-white backdrop-blur">
                                                    {asset.type === 'video' ? `${t('视频')}${asset.duration ? ` · ${t('{seconds} 秒', { seconds: asset.duration })}` : ''}` : t('图片')}
                                                </span>
                                                {selectingAssets ? (
                                                    <span
                                                        aria-hidden="true"
                                                        className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md border shadow-lg ${selectedAssetIdSet.has(asset.id) ? 'border-violet-400 bg-violet-500 text-white' : 'border-white/70 bg-black/50'}`}>
                                                        {selectedAssetIdSet.has(asset.id) && <Check className="h-4 w-4" />}
                                                    </span>
                                                ) : (
                                                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-violet-600/90 px-2.5 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                                        <Sparkles className="h-3 w-3" />
                                                        {t('二次创作')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className={`px-4 pt-4 ${selectingAssets ? 'pb-4' : ''}`}>
                                                <p className="line-clamp-2 min-h-10 text-sm leading-5 text-slate-200">{asset.prompt || '未记录提示词'}</p>
                                                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                                                    <Clock3 className="h-3.5 w-3.5" />
                                                    {new Date(asset.createdAt).toLocaleString(locale, { hour12: false })}
                                                </div>
                                            </div>
                                        </button>
                                        {!selectingAssets && (
                                            <div className="p-4 pt-3">
                                                <div className="flex items-center gap-2">
                                                    <a
                                                        href={asset.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-2 text-xs text-slate-300 hover:bg-white/5">
                                                        <Download className="h-3.5 w-3.5" />
                                                        {t('查看/下载')}
                                                    </a>
                                                    {asset.type === 'video' && (
                                                        <button
                                                            onClick={() => chooseCover(asset.id)}
                                                            disabled={coverUpdating || deletingAssets}
                                                            className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/5 hover:text-violet-300 disabled:opacity-50"
                                                            aria-label={t('设置封面')}>
                                                            <Images className="h-4 w-4" />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => removeAsset(asset)}
                                                        disabled={deletingAssets}
                                                        className="rounded-lg border border-red-500/15 p-2 text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                                                        aria-label={t('删除作品')}>
                                                        {deletingAssetIds.includes(asset.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        ) : (
                            !assetsLoading && (
                                <div className="mt-6 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-slate-600">
                                    <Images className="h-9 w-9" />
                                    <p className="mt-3 text-sm">
                                        {t('还没有')}
                                        {assetFilter === 'all' ? '' : assetFilter === 'image' ? '图片' : '视频'}
                                        {t('作品')}
                                    </p>
                                </div>
                            )
                        )}
                        {assetsLoading && (
                            <div className="mt-6 flex items-center justify-center py-8 text-sm text-slate-500">
                                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                                {t('正在加载作品…')}
                            </div>
                        )}
                        {nextCursor && !assetsLoading && (
                            <button
                                onClick={() => loadAssets(assetFilter, nextCursor)}
                                disabled={deletingAssets}
                                className="mx-auto mt-6 block rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                                {t('加载更多')}
                            </button>
                        )}
                    </section>
                )}
                <input
                    ref={coverFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={event => void uploadCover(event.target.files?.[0])}
                />
                {confirmDialog}
            </main>
            <SiteFooter />
        </div>
    )
}
