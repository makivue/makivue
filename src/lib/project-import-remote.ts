import { apiError } from '@/lib/utils'
import { parseImportTextFast, type DetectedScriptEpisode, type DetectedScriptResult } from '@/services/script-import'

const IMPORT_API_PATH = '/api/projects/import'
const IMPORT_COMMIT_API_PATH = '/api/projects/import/commit'

type ApiEnvelope = {
    success?: boolean
    data?: unknown
    error?: string
}

export type RemoteImportResponse = {
    status: number
    body: string
    contentType: string | null
    retryAfter: string | null
    payload: ApiEnvelope | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function shouldUseRemoteProjectImport() {
    return false
}

async function requestRemoteApi(_req: Request, _pathname: string, _init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; timeoutMs?: number }): Promise<RemoteImportResponse> {
    void _req
    void _pathname
    void _init

    throw new Error('Remote project imports are disabled; use the local import workflow')
}

export function remoteImportResponse(result: RemoteImportResponse, fallbackMessage = '测试环境导入服务暂时不可用，请稍后重试') {
    if (!result.payload) return apiError(fallbackMessage, result.status >= 400 && result.status <= 599 ? result.status : 503)
    const headers = new Headers({ 'Content-Type': result.contentType?.includes('application/json') ? result.contentType : 'application/json' })
    if (result.retryAfter) headers.set('Retry-After', result.retryAfter)
    return new Response(result.body, { status: result.status, headers })
}

function successfulRemoteResult(data: Record<string, unknown>, status = 200): RemoteImportResponse {
    const body = JSON.stringify({ success: true, data })
    return { status, body, contentType: 'application/json', retryAfter: null, payload: { success: true, data } }
}

function invalidRemoteResult(message: string): RemoteImportResponse {
    const body = JSON.stringify({ success: false, error: message })
    return { status: 502, body, contentType: 'application/json', retryAfter: null, payload: { success: false, error: message } }
}

function successfulData(result: RemoteImportResponse): Record<string, unknown> | null {
    return result.payload?.success && isRecord(result.payload.data) ? result.payload.data : null
}

function stableImportKey(body: Record<string, unknown>) {
    if (typeof body.jobId === 'string' && body.jobId) return `job:${body.jobId}`
    if (typeof body.importId === 'string' && body.importId) return `draft:${body.importId}`
    return null
}

const globalForRemoteImport = globalThis as typeof globalThis & { projectImportRemoteProjects?: Map<string, string> }
const remoteImportProjects = (globalForRemoteImport.projectImportRemoteProjects ??= new Map<string, string>())

function detectedEpisode(detected: DetectedScriptResult, episodeNumber: number) {
    const episode = detected.episodes?.find(item => item.episodeNumber === episodeNumber)
    const outline = detected.outline?.find(item => item.episodeNumber === episodeNumber)
    return { episode, outline }
}

function chapterContentForFallback(detected: DetectedScriptResult, episode: DetectedScriptEpisode | undefined, synopsis: string, title: string) {
    if (detected.stage === 'novel') return episode?.chapterContent?.trim() || synopsis || title
    if (detected.stage === 'script' || detected.stage === 'storyboard') return episode?.chapterContent?.trim() || episode?.script?.trim() || synopsis || title
    return synopsis || title
}

async function recoverQueuedRemoteCommit(req: Request, jobId: string): Promise<RemoteImportResponse | null> {
    const status = await getProjectImportStatusRemotely(req, jobId).catch(() => null)
    const data = status ? successfulData(status) : null
    if (!data) return null
    if (data.phase === 'done' && isRecord(data.result)) return successfulRemoteResult(data.result)
    if (data.phase === 'queued' || data.phase === 'generating' || data.phase === 'writing_db') return successfulRemoteResult({ jobId }, 202)
    return null
}

/**
 * Last-resort development bridge for test deployments whose dedicated commit
 * endpoint is broken. It composes the stable project/episode/storyboard APIs,
 * and remembers the created project so retrying a partial import resumes it.
 */
export async function persistProjectImportThroughRemoteCrud(req: Request, body: Record<string, unknown>, detected: DetectedScriptResult): Promise<RemoteImportResponse> {
    const importKey = stableImportKey(body)
    const totalEpisodes = Math.max(1, detected.totalEpisodes ?? detected.episodes?.length ?? detected.outline?.length ?? 1)
    const title = detected.projectTitle?.trim() || `导入项目 ${new Date().toISOString().slice(0, 10)}`
    const visualStyle = typeof body.visualStyle === 'string' ? body.visualStyle : 'cinematic'
    const videoAspectRatio = body.videoAspectRatio === '16:9' || body.videoAspectRatio === '1:1' ? body.videoAspectRatio : '9:16'
    let projectId = importKey ? remoteImportProjects.get(importKey) : undefined

    if (!projectId) {
        const created = await requestRemoteApi(req, '/api/projects', {
            method: 'POST',
            body: {
                title,
                description: detected.projectDescription ?? '',
                genre: detected.genre ?? '',
                totalEpisodes,
                visualStyle,
                videoAspectRatio
            },
            timeoutMs: 30_000
        })
        const createdData = successfulData(created)
        const createdId = createdData && (typeof createdData.id === 'string' || typeof createdData.id === 'number') ? String(createdData.id) : null
        if (!createdId) return created.payload ? created : invalidRemoteResult('测试环境创建项目失败，请稍后重试')
        projectId = createdId
        if (importKey) remoteImportProjects.set(importKey, projectId)
    }

    const projectResult = await requestRemoteApi(req, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'GET', timeoutMs: 20_000 })
    const project = successfulData(projectResult)
    const remoteEpisodes = project && Array.isArray(project.episodes) ? project.episodes.filter(isRecord) : []
    if (remoteEpisodes.length < totalEpisodes) return projectResult.payload?.success ? invalidRemoteResult('测试环境未创建完整剧集，请重试') : projectResult

    const joinedNovel = (detected.episodes ?? [])
        .map(episode => episode.chapterContent?.trim())
        .filter((value): value is string => Boolean(value))
        .join('\n\n---\n\n')
    const fullNovel = detected.novel?.trim() || joinedNovel || (detected.stage === 'script' || detected.stage === 'storyboard' ? body.text : null)
    if (typeof fullNovel === 'string' && fullNovel.trim()) {
        const patchedProject = await requestRemoteApi(req, `/api/projects/${encodeURIComponent(projectId)}`, {
            method: 'PATCH',
            body: { novel: fullNovel },
            timeoutMs: 30_000
        })
        if (!patchedProject.payload?.success) return patchedProject
    }

    const episodeIds: string[] = []
    for (let index = 0; index < totalEpisodes; index += 1) {
        const episodeNumber = index + 1
        const remoteEpisode = remoteEpisodes.find(item => Number(item.episodeNumber) === episodeNumber)
        const episodeId = remoteEpisode && (typeof remoteEpisode.id === 'string' || typeof remoteEpisode.id === 'number') ? String(remoteEpisode.id) : null
        if (!episodeId) return invalidRemoteResult(`测试环境缺少第 ${episodeNumber} 集，请重试`)
        episodeIds.push(episodeId)

        const { episode, outline } = detectedEpisode(detected, episodeNumber)
        const episodeTitle = (episode?.title ?? outline?.title ?? `第${episodeNumber}集`).slice(0, 255)
        const synopsis = episode?.synopsis ?? outline?.synopsis ?? ''
        const intensity = outline?.intensity
        const patched = await requestRemoteApi(req, `/api/episodes/${encodeURIComponent(episodeId)}`, {
            method: 'PATCH',
            body: {
                title: episodeTitle,
                synopsis,
                chapterContent: chapterContentForFallback(detected, episode, synopsis, episodeTitle),
                script: episode?.script ?? null,
                ...(typeof intensity === 'number' ? { intensity: Math.max(0, Math.min(100, Math.round(intensity))) } : {})
            },
            timeoutMs: 30_000
        })
        if (!patched.payload?.success) return patched
    }

    // Finalizing all episodes advances the project to the last readable novel
    // stage. Outline/novel imports are then moved back to their exact stage.
    for (const episodeId of episodeIds) {
        const finalized = await requestRemoteApi(req, `/api/episodes/${encodeURIComponent(episodeId)}/finalize`, { method: 'POST', body: {}, timeoutMs: 30_000 })
        if (!finalized.payload?.success) return finalized
    }

    if (detected.stage === 'outline' || detected.stage === 'novel') {
        for (const episodeId of episodeIds) {
            const unfinalized = await requestRemoteApi(req, `/api/episodes/${encodeURIComponent(episodeId)}/unfinalize`, { method: 'POST', body: {}, timeoutMs: 30_000 })
            if (!unfinalized.payload?.success) return unfinalized
        }
        if (detected.stage === 'outline') {
            const reset = await requestRemoteApi(req, `/api/projects/${encodeURIComponent(projectId)}/reset-drafts`, { method: 'POST', body: {}, timeoutMs: 30_000 })
            if (!reset.payload?.success) return reset
            const clearedNovel = await requestRemoteApi(req, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: { novel: null }, timeoutMs: 30_000 })
            if (!clearedNovel.payload?.success) return clearedNovel
        }
    } else {
        for (let index = 0; index < episodeIds.length; index += 1) {
            const episodeId = episodeIds[index]
            const { episode } = detectedEpisode(detected, index + 1)
            const importedStoryboards = episode?.storyboards ?? []
            const storyboardPayload =
                importedStoryboards.length > 0
                    ? importedStoryboards
                    : [
                          {
                              order: 1000,
                              duration: 1,
                              actionDesc: '导入剧本状态标记'
                          }
                      ]
            let firstBatch = true
            let markerId: string | null = null
            for (let offset = 0; offset < storyboardPayload.length; offset += 200) {
                const created = await requestRemoteApi(req, `/api/episodes/${encodeURIComponent(episodeId)}/storyboards`, {
                    method: 'POST',
                    body: { storyboards: storyboardPayload.slice(offset, offset + 200), overwriteExisting: firstBatch },
                    timeoutMs: 30_000
                })
                const createdRows = created.payload?.success && Array.isArray(created.payload.data) ? created.payload.data.filter(isRecord) : null
                if (!createdRows) return created
                if (importedStoryboards.length === 0 && createdRows[0] && (typeof createdRows[0].id === 'string' || typeof createdRows[0].id === 'number')) markerId = String(createdRows[0].id)
                firstBatch = false
            }
            if (markerId) {
                const removed = await requestRemoteApi(req, `/api/storyboards/${encodeURIComponent(markerId)}`, { method: 'DELETE', timeoutMs: 20_000 })
                if (!removed.payload?.success) return removed
            }
        }
    }

    return successfulRemoteResult({
        projectId,
        stage: detected.stage,
        novelStage: detected.stage === 'outline' ? 'outlined' : detected.stage === 'novel' ? 'drafting' : 'finalized',
        totalEpisodes,
        totalStoryboards: (detected.episodes ?? []).reduce((total, episode) => total + (episode.storyboards?.length ?? 0), 0),
        detectedTitle: detected.projectTitle,
        detectedGenre: detected.genre,
        visualStyle
    })
}

/**
 * Persist a locally parsed import in the same test environment used by all
 * other proxied project APIs. New deployments accept the stateless payload
 * directly; older deployments are bridged through their job-based contract.
 */
export async function commitProjectImportRemotely(req: Request, body: Record<string, unknown>): Promise<RemoteImportResponse> {
    // Current local flow always includes the source text. Persist it directly
    // through the stable CRUD endpoints instead of invoking the test
    // deployment's broken/background import route.
    if (typeof body.text === 'string') {
        return persistProjectImportThroughRemoteCrud(req, body, parseImportTextFast(body.text, typeof body.filename === 'string' ? body.filename : undefined))
    }

    // Compatibility for a tab opened before the synchronous import flow was
    // deployed. New requests never enter this branch.
    if (typeof body.jobId === 'string') {
        const committed = await requestRemoteApi(req, IMPORT_COMMIT_API_PATH, { method: 'POST', body, timeoutMs: 30_000 })
        if (committed.payload?.success) return committed
        if (committed.status >= 500) {
            const recovered = await recoverQueuedRemoteCommit(req, body.jobId)
            if (recovered) return recovered
            if (typeof body.text === 'string') return persistProjectImportThroughRemoteCrud(req, body, parseImportTextFast(body.text, typeof body.filename === 'string' ? body.filename : undefined))
        }
        return committed
    }

    return invalidRemoteResult('导入识别结果已失效，请重新识别')
}

export async function getProjectImportStatusRemotely(req: Request, jobId: string) {
    return requestRemoteApi(req, `${IMPORT_API_PATH}/status/${encodeURIComponent(jobId)}`, { method: 'GET', timeoutMs: 20_000 })
}
