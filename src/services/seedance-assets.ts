import { createHash, createHmac } from 'node:crypto'
import type { SeedanceConfig } from './seedance-config'
import { fetchMeteredProvider, reportProviderTokenUsage } from '@/lib/provider-token-usage.server'

export const SEEDANCE_PRIVACY_ERROR_CODE = 'InputImageSensitiveContentDetected.PrivacyInformation'

// Server-side fallback used only by the Seedance material-library recovery flow.
// Deployment env vars and the Seedance assetLibrary config keep higher priority
// so credentials can be rotated without a code change.
// The deployed Seedance endpoint ep-configure-1 belongs to the
// `moviebox` Ark project. Assets are project-isolated and must be uploaded to
// that same project or the video API reports "specified asset ... not found".
const BUILTIN_SEEDANCE_PROJECT_NAME = 'moviebox'
const BUILTIN_SEEDANCE_ASSET_GROUP_ID = 'group-20260729230102-zm9r8'

type JsonObject = Record<string, unknown>
type FetchLike = typeof fetch

export interface SeedanceAssetLibraryConfig {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
    projectName: string
    groupId?: string
    aigcGroupId?: string
    groupName: string
    region: string
    endpoint: string
}

function normalizeAssetId(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim().replace(/^asset:\/\//, '')
    return /^asset-[a-zA-Z0-9-]+$/.test(normalized) ? normalized : null
}

interface SeedanceAssetRecovery {
    triggerCode: typeof SEEDANCE_PRIVACY_ERROR_CODE
    assetIds: string[]
}

export interface SeedanceTaskCreateResult {
    taskId: string
    requestBody: JsonObject
    recovery?: SeedanceAssetRecovery
}

interface CreateSeedanceTaskOptions {
    baseUrl: string
    apiKey: string
    requestBody: JsonObject
    seedanceConfig: SeedanceConfig
    errorLabel?: string
    signal?: AbortSignal
    fetchImpl?: FetchLike
    sleepImpl?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

type ArkOpenApiAction = 'CreateAssetGroup' | 'ListAssetGroups' | 'CreateAsset' | 'GetAsset' | 'ListAssets' | 'GetEndpoint' | 'CreateVisualValidateSession' | 'GetVisualValidateResult'

interface ArkOpenApiOptions {
    action: ArkOpenApiAction
    body: JsonObject
    config: SeedanceAssetLibraryConfig
    signal?: AbortSignal
    fetchImpl?: FetchLike
    now?: Date
}

function firstNonEmpty(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
}

function parseExtra(extra: string | null): JsonObject {
    if (!extra) return {}
    try {
        const parsed = JSON.parse(extra)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {}
    } catch {
        return {}
    }
}

export function getSeedanceAssetLibraryConfig(seedanceConfig: SeedanceConfig): SeedanceAssetLibraryConfig | null {
    const extra = parseExtra(seedanceConfig.extra)
    const nested = extra.assetLibrary && typeof extra.assetLibrary === 'object' && !Array.isArray(extra.assetLibrary) ? (extra.assetLibrary as JsonObject) : extra

    // Keep compatibility with the official Volcengine SDK variable names, while
    // also accepting the ARK-prefixed names commonly used by this application.
    const accessKeyId = firstNonEmpty(process.env.VOLCENGINE_ACCESS_KEY, process.env.VOLCSTACK_ACCESS_KEY_ID, process.env.VOLCSTACK_ACCESS_KEY, process.env.ARK_ACCESS_KEY_ID, nested.accessKeyId)
    const secretAccessKey = firstNonEmpty(
        process.env.VOLCENGINE_SECRET_KEY,
        process.env.VOLCSTACK_SECRET_ACCESS_KEY,
        process.env.VOLCSTACK_SECRET_KEY,
        process.env.ARK_SECRET_ACCESS_KEY,
        nested.secretAccessKey,
        nested.accessKeySecret
    )
    if (!accessKeyId || !secretAccessKey) return null

    const region = firstNonEmpty(process.env.SEEDANCE_ASSET_REGION, nested.region) ?? 'cn-beijing'
    const projectName = firstNonEmpty(process.env.SEEDANCE_PROJECT_NAME, nested.projectName) ?? BUILTIN_SEEDANCE_PROJECT_NAME
    const configuredGroupId = firstNonEmpty(process.env.SEEDANCE_ASSET_GROUP_ID, nested.assetGroupId, nested.groupId)
    return {
        accessKeyId,
        secretAccessKey,
        sessionToken: firstNonEmpty(process.env.VOLCENGINE_SESSION_TOKEN, process.env.VOLCSTACK_SESSION_TOKEN, process.env.ARK_SESSION_TOKEN, nested.sessionToken),
        projectName,
        groupId: configuredGroupId ?? (projectName === BUILTIN_SEEDANCE_PROJECT_NAME ? BUILTIN_SEEDANCE_ASSET_GROUP_ID : undefined),
        aigcGroupId: firstNonEmpty(process.env.SEEDANCE_AIGC_ASSET_GROUP_ID, nested.aigcAssetGroupId),
        groupName: firstNonEmpty(process.env.SEEDANCE_ASSET_GROUP_NAME, nested.assetGroupName, nested.groupName) ?? 'local-drama-studio-virtual-characters',
        region,
        endpoint: firstNonEmpty(process.env.SEEDANCE_ASSET_API_BASE_URL, nested.endpoint) ?? `https://ark.${region}.volcengineapi.com`
    }
}

function sha256(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Uint8Array, value: string): Buffer {
    return createHmac('sha256', key).update(value).digest()
}

function volcengineTimestamp(now: Date): string {
    return now.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export function buildVolcengineSignedRequest(action: ArkOpenApiAction, body: JsonObject, config: SeedanceAssetLibraryConfig, now = new Date()) {
    const endpoint = new URL(config.endpoint)
    const query = new URLSearchParams({ Action: action, Version: '2024-01-01' })
    query.sort()
    endpoint.pathname = '/'
    endpoint.search = query.toString()

    const payload = JSON.stringify(body)
    const payloadHash = sha256(payload)
    const timestamp = volcengineTimestamp(now)
    const date = timestamp.slice(0, 8)
    const headerEntries: Array<[string, string]> = [
        ['content-type', 'application/json; charset=utf-8'],
        ['host', endpoint.host],
        ['x-content-sha256', payloadHash],
        ['x-date', timestamp]
    ]
    if (config.sessionToken) headerEntries.push(['x-security-token', config.sessionToken])
    headerEntries.sort(([left], [right]) => left.localeCompare(right))

    const signedHeaders = headerEntries.map(([key]) => key).join(';')
    const canonicalHeaders = headerEntries.map(([key, value]) => `${key}:${value.trim()}\n`).join('')
    const canonicalRequest = ['POST', '/', query.toString(), canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${date}/${config.region}/ark/request`
    const stringToSign = ['HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n')
    const signingKey = hmac(hmac(hmac(hmac(config.secretAccessKey, date), config.region), 'ark'), 'request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Sha256': payloadHash,
        'X-Date': timestamp,
        Authorization: `HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
    if (config.sessionToken) headers['X-Security-Token'] = config.sessionToken

    return { url: endpoint.toString(), headers, body: payload }
}

function asObject(value: unknown): JsonObject | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null
}

function responseResult(value: unknown): JsonObject {
    const root = asObject(value) ?? {}
    return asObject(root.Result) ?? root
}

function getArkError(value: unknown): { code?: string; message?: string; requestId?: string } | null {
    const root = asObject(value)
    const metadata = asObject(root?.ResponseMetadata)
    const error = asObject(metadata?.Error)
    if (!error) return null
    return {
        code: firstNonEmpty(error.Code),
        message: firstNonEmpty(error.Message),
        requestId: firstNonEmpty(metadata?.RequestId)
    }
}

async function callArkOpenApi(options: ArkOpenApiOptions): Promise<JsonObject> {
    const fetchImpl = options.fetchImpl ?? fetch
    const signed = buildVolcengineSignedRequest(options.action, options.body, options.config, options.now)
    const response = await fetchImpl(signed.url, {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
        signal: requestSignal(60_000, options.signal)
    })
    const raw = await response.text()
    let parsed: unknown = null
    try {
        parsed = raw ? JSON.parse(raw) : {}
    } catch {}
    const apiError = getArkError(parsed)
    if (!response.ok || apiError) {
        const detail = apiError ? [apiError.code, apiError.message, apiError.requestId && `requestId=${apiError.requestId}`].filter(Boolean).join(': ') : raw.slice(0, 1_000)
        throw new Error(`Seedance material ${options.action} failed (${response.status}): ${detail || 'empty response'}`)
    }
    return responseResult(parsed)
}

interface SeedanceAssetApiOptions {
    signal?: AbortSignal
    fetchImpl?: FetchLike
}

export interface SeedanceVisualValidationSession {
    bytedToken: string
    h5Link: string
    callbackUrl: string
    projectName: string
}

export interface SeedancePortraitAssetStatus {
    assetId: string
    groupId: string | null
    projectName: string
    status: string
}

const endpointProjectPromises = new Map<string, Promise<string>>()

async function resolveSeedanceAssetProject(seedanceConfig: SeedanceConfig, options: SeedanceAssetApiOptions = {}): Promise<{ config: SeedanceAssetLibraryConfig; projectName: string }> {
    const config = getSeedanceAssetLibraryConfig(seedanceConfig)
    if (!config) throw new Error('Seedance 官方素材库 AK/SK 未配置')

    const endpointId = firstNonEmpty(seedanceConfig.modelName)
    if (!endpointId?.startsWith('ep-')) return { config, projectName: config.projectName }

    const cacheKey = `${config.accessKeyId}:${config.region}:${endpointId}`
    const existing = endpointProjectPromises.get(cacheKey)
    const promise =
        existing ??
        (async () => {
            const endpoint = await callArkOpenApi({
                action: 'GetEndpoint',
                body: { Id: endpointId },
                config,
                signal: options.signal,
                fetchImpl: options.fetchImpl
            })
            const projectName = firstNonEmpty(endpoint.ProjectName)
            if (!projectName) throw new Error('Seedance 接入点未返回所属项目，无法安全使用官方素材库')
            return projectName
        })()
    if (!existing) endpointProjectPromises.set(cacheKey, promise)
    try {
        const projectName = await promise
        return {
            projectName,
            config: {
                ...config,
                projectName,
                groupId: projectName === config.projectName ? config.groupId : undefined,
                aigcGroupId: projectName === config.projectName ? config.aigcGroupId : undefined
            }
        }
    } catch (error) {
        endpointProjectPromises.delete(cacheKey)
        throw error
    }
}

export async function createSeedanceVisualValidationSession(seedanceConfig: SeedanceConfig, callbackUrl: string, options: SeedanceAssetApiOptions = {}): Promise<SeedanceVisualValidationSession> {
    const { config, projectName } = await resolveSeedanceAssetProject(seedanceConfig, options)
    const result = await callArkOpenApi({
        action: 'CreateVisualValidateSession',
        body: { CallbackURL: callbackUrl, ProjectName: projectName },
        config,
        signal: options.signal,
        fetchImpl: options.fetchImpl
    })
    const bytedToken = firstNonEmpty(result.BytedToken)
    const h5Link = firstNonEmpty(result.H5Link)
    if (!bytedToken || !h5Link) throw new Error('真人认证接口未返回认证凭证或认证链接')
    return {
        bytedToken,
        h5Link,
        callbackUrl: firstNonEmpty(result.CallbackURL) ?? callbackUrl,
        projectName
    }
}

export async function getSeedanceVisualValidationResult(seedanceConfig: SeedanceConfig, bytedToken: string, options: SeedanceAssetApiOptions = {}): Promise<{ groupId: string; projectName: string }> {
    const { config, projectName } = await resolveSeedanceAssetProject(seedanceConfig, options)
    const result = await callArkOpenApi({
        action: 'GetVisualValidateResult',
        body: { BytedToken: bytedToken, ProjectName: projectName },
        config,
        signal: options.signal,
        fetchImpl: options.fetchImpl
    })
    const groupId = firstNonEmpty(result.GroupId)
    if (!groupId || !/^group-[a-zA-Z0-9-]+$/.test(groupId)) throw new Error('真人认证结果未返回有效的素材组')
    return { groupId, projectName }
}

export async function createSeedancePortraitAsset(
    seedanceConfig: SeedanceConfig,
    input: { groupId: string; sourceUrl: string; name: string; assetType?: 'Image' | 'Video' | 'Audio' },
    options: SeedanceAssetApiOptions = {}
): Promise<{ assetId: string; projectName: string }> {
    const { config, projectName } = await resolveSeedanceAssetProject(seedanceConfig, options)
    const result = await callArkOpenApi({
        action: 'CreateAsset',
        body: {
            GroupId: input.groupId,
            URL: input.sourceUrl,
            AssetType: input.assetType ?? 'Image',
            Name: input.name,
            ProjectName: projectName
        },
        config,
        signal: options.signal,
        fetchImpl: options.fetchImpl
    })
    const assetId = normalizeAssetId(result.Id)
    if (!assetId) throw new Error('真人素材上传接口未返回有效的素材 ID')
    return { assetId, projectName }
}

export async function getSeedancePortraitAssetStatus(seedanceConfig: SeedanceConfig, assetId: string, options: SeedanceAssetApiOptions = {}): Promise<SeedancePortraitAssetStatus> {
    const normalizedAssetId = normalizeAssetId(assetId)
    if (!normalizedAssetId) throw new Error('真人素材 ID 格式无效')
    const { config, projectName } = await resolveSeedanceAssetProject(seedanceConfig, options)
    const result = await callArkOpenApi({
        action: 'GetAsset',
        body: { Id: normalizedAssetId, ProjectName: projectName },
        config,
        signal: options.signal,
        fetchImpl: options.fetchImpl
    })
    return {
        assetId: normalizedAssetId,
        groupId: firstNonEmpty(result.GroupId) ?? null,
        projectName: firstNonEmpty(result.ProjectName) ?? projectName,
        status: firstNonEmpty(result.Status) ?? 'Unknown'
    }
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason
    await new Promise<void>((resolve, reject) => {
        const finish = () => {
            signal?.removeEventListener('abort', abort)
            resolve()
        }
        const abort = () => {
            clearTimeout(timer)
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(finish, milliseconds)
        signal?.addEventListener('abort', abort, { once: true })
    })
}

const aigcGroupPromises = new Map<string, Promise<string>>()
const aigcAssetPromises = new Map<string, Promise<string>>()

async function ensureAigcAssetGroup(config: SeedanceAssetLibraryConfig, signal: AbortSignal | undefined, fetchImpl: FetchLike): Promise<string> {
    if (config.aigcGroupId) return config.aigcGroupId
    const cacheKey = `${config.accessKeyId}:${config.region}:${config.projectName}:${config.groupName}`
    const existing = aigcGroupPromises.get(cacheKey)
    if (existing) return existing

    const promise = (async () => {
        const listed = await callArkOpenApi({
            action: 'ListAssetGroups',
            body: {
                Filter: { Name: config.groupName, GroupType: 'AIGC' },
                PageNumber: 1,
                PageSize: 100,
                ProjectName: config.projectName
            },
            config,
            signal,
            fetchImpl
        })
        const matched = (Array.isArray(listed.Items) ? listed.Items : [])
            .map(asObject)
            .find(
                item =>
                    firstNonEmpty(item?.Name) === config.groupName &&
                    firstNonEmpty(item?.ProjectName) === config.projectName &&
                    (!firstNonEmpty(item?.GroupType) || firstNonEmpty(item?.GroupType)?.toUpperCase() === 'AIGC')
            )
        const existingId = normalizeGroupId(matched?.Id)
        if (existingId) return existingId

        const created = await callArkOpenApi({
            action: 'CreateAssetGroup',
            body: {
                Name: config.groupName,
                Description: 'Seedance fictional-character recovery assets',
                GroupType: 'AIGC',
                ProjectName: config.projectName
            },
            config,
            signal,
            fetchImpl
        })
        const groupId = normalizeGroupId(created.Id)
        if (!groupId) throw new Error('Seedance 官方素材库创建 AIGC 素材组后未返回有效 ID')
        return groupId
    })()
    aigcGroupPromises.set(cacheKey, promise)
    try {
        return await promise
    } catch (error) {
        aigcGroupPromises.delete(cacheKey)
        throw error
    }
}

function normalizeGroupId(value: unknown): string | null {
    const groupId = firstNonEmpty(value)
    return groupId && /^group-[a-zA-Z0-9-]+$/.test(groupId) ? groupId : null
}

async function waitForAigcAssetActive(
    assetId: string,
    config: SeedanceAssetLibraryConfig,
    signal: AbortSignal | undefined,
    fetchImpl: FetchLike,
    sleepImpl: (milliseconds: number, signal?: AbortSignal) => Promise<void>
): Promise<void> {
    const intervalMs = Math.max(1_000, Number(process.env.SEEDANCE_ASSET_POLL_INTERVAL_MS) || 5_000)
    const timeoutMs = Math.max(60_000, Number(process.env.SEEDANCE_ASSET_TIMEOUT_MS) || 20 * 60_000)
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        const asset = await callArkOpenApi({
            action: 'GetAsset',
            body: { Id: assetId, ProjectName: config.projectName },
            config,
            signal,
            fetchImpl
        })
        const status = firstNonEmpty(asset.Status)?.toLowerCase()
        if (['active', 'succeeded', 'success', 'published', 'available'].includes(status ?? '')) return
        if (['failed', 'rejected', 'error'].includes(status ?? '')) {
            throw new Error(`官方 AIGC 素材 ${assetId} 审核或预处理失败`)
        }
        await sleepImpl(intervalMs, signal)
    }
    throw new Error(`官方 AIGC 素材 ${assetId} 在 ${Math.round(timeoutMs / 60_000)} 分钟内未完成处理`)
}

async function uploadAigcAsset(
    sourceUrl: string,
    config: SeedanceAssetLibraryConfig,
    signal: AbortSignal | undefined,
    fetchImpl: FetchLike,
    sleepImpl: (milliseconds: number, signal?: AbortSignal) => Promise<void>
): Promise<string> {
    const cacheKey = `${config.accessKeyId}:${config.projectName}:${sourceUrl}`
    const existing = aigcAssetPromises.get(cacheKey)
    if (existing) return existing

    const promise = (async () => {
        const groupId = await ensureAigcAssetGroup(config, signal, fetchImpl)
        const created = await callArkOpenApi({
            action: 'CreateAsset',
            body: {
                GroupId: groupId,
                URL: sourceUrl,
                AssetType: 'Image',
                Name: `seedance-fictional-${sha256(sourceUrl).slice(0, 16)}`,
                ProjectName: config.projectName
            },
            config,
            signal,
            fetchImpl
        })
        const assetId = normalizeAssetId(created.Id)
        if (!assetId) throw new Error('Seedance 官方素材库上传图片后未返回有效素材 ID')
        await waitForAigcAssetActive(assetId, config, signal, fetchImpl, sleepImpl)
        return assetId
    })()
    aigcAssetPromises.set(cacheKey, promise)
    try {
        return await promise
    } catch (error) {
        aigcAssetPromises.delete(cacheKey)
        throw error
    }
}

export function isSeedancePrivacyInformationError(responseText: string): boolean {
    try {
        const parsed = JSON.parse(responseText)
        const root = asObject(parsed)
        const error = asObject(root?.error)
        return firstNonEmpty(error?.code) === SEEDANCE_PRIVACY_ERROR_CODE
    } catch {
        return responseText.includes(SEEDANCE_PRIVACY_ERROR_CODE)
    }
}

async function submitSeedanceTask(baseUrl: string, apiKey: string, requestBody: JsonObject, signal: AbortSignal | undefined, fetchImpl: FetchLike) {
    const url = `${baseUrl}/api/v3/contents/generations/tasks`
    const sentAt = new Date().toISOString()
    const response = await fetchMeteredProvider(
        url,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody),
            signal: requestSignal(60_000, signal)
        },
        { provider: 'volcengine', model: String(requestBody.model), fetchImpl }
    )
    const text = await response.text()
    if (!response.ok) return { ok: false as const, status: response.status, text }

    let data: JsonObject = {}
    try {
        data = responseResult(JSON.parse(text))
    } catch {
        throw new Error(`Seedance create returned invalid JSON: ${text.slice(0, 500)}`)
    }
    const taskId = firstNonEmpty(data.id, data.Id)
    let rawPayload: unknown = text
    try {
        rawPayload = text ? JSON.parse(text) : {}
    } catch {}
    await reportProviderTokenUsage({
        provider: 'volcengine',
        model: firstNonEmpty(requestBody.model) ?? 'seedance',
        endpoint: '/api/v3/contents/generations/tasks',
        response,
        payload: rawPayload,
        sentAt,
        operationKey: taskId ? `seedance-video:${taskId}` : undefined
    })
    if (!taskId) throw new Error('No task ID returned')
    return { ok: true as const, taskId }
}

function imageInputs(requestBody: JsonObject): Array<{ contentIndex: number; sourceUrl: string }> {
    if (!Array.isArray(requestBody.content)) return []
    const inputs: Array<{ contentIndex: number; sourceUrl: string }> = []
    requestBody.content.forEach((entry, contentIndex) => {
        const content = asObject(entry)
        if (content?.type !== 'image_url') return
        const sourceUrl = firstNonEmpty(asObject(content.image_url)?.url)
        if (sourceUrl?.startsWith('http://') || sourceUrl?.startsWith('https://')) {
            inputs.push({ contentIndex, sourceUrl })
        }
    })
    return inputs
}

function replaceImageUrls(requestBody: JsonObject, replacements: Map<number, string>): JsonObject {
    const content = Array.isArray(requestBody.content)
        ? requestBody.content.map((entry, index) => {
              const assetUrl = replacements.get(index)
              if (!assetUrl) return entry
              const item = asObject(entry) ?? {}
              return { ...item, image_url: { ...(asObject(item.image_url) ?? {}), url: assetUrl } }
          })
        : requestBody.content
    return { ...requestBody, content }
}

export async function createSeedanceTaskWithAssetRecovery(options: CreateSeedanceTaskOptions): Promise<SeedanceTaskCreateResult> {
    const fetchImpl = options.fetchImpl ?? fetch
    const errorLabel = options.errorLabel ?? 'Seedance create error'
    const first = await submitSeedanceTask(options.baseUrl, options.apiKey, options.requestBody, options.signal, fetchImpl)
    if (first.ok) return { taskId: first.taskId, requestBody: options.requestBody }
    if (!isSeedancePrivacyInformationError(first.text)) {
        throw new Error(`${errorLabel}: ${first.text}`)
    }

    try {
        const { config: assetConfig } = await resolveSeedanceAssetProject(options.seedanceConfig, {
            signal: options.signal,
            fetchImpl
        })
        const inputs = imageInputs(options.requestBody)
        if (!inputs.length) throw new Error('当前任务没有可上传到官方素材库的 HTTP(S) 分镜图片')
        const sleepImpl = options.sleepImpl ?? sleep
        const uploaded = await Promise.all(
            inputs.map(async input => ({
                contentIndex: input.contentIndex,
                assetId: await uploadAigcAsset(input.sourceUrl, assetConfig, options.signal, fetchImpl, sleepImpl)
            }))
        )
        const recoveredRequestBody = replaceImageUrls(options.requestBody, new Map(uploaded.map(item => [item.contentIndex, `asset://${item.assetId}`])))
        const retry = await submitSeedanceTask(options.baseUrl, options.apiKey, recoveredRequestBody, options.signal, fetchImpl)
        if (!retry.ok) {
            if (isSeedancePrivacyInformationError(retry.text)) {
                throw new Error('虚构角色图片已上传官方 AIGC 素材库，但视频服务仍判定画面包含真人特征。无需真人认证，请调整当前插图的人脸写实度后重新生成。')
            }
            throw new Error(`官方 AIGC 素材已入库，但视频任务创建仍失败：${retry.text}`)
        }
        return {
            taskId: retry.taskId,
            requestBody: recoveredRequestBody,
            recovery: {
                triggerCode: SEEDANCE_PRIVACY_ERROR_CODE,
                assetIds: uploaded.map(item => item.assetId)
            }
        }
    } catch (error) {
        const recoveryMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`虚构角色官方素材库恢复失败：${recoveryMessage}`)
    }
}
