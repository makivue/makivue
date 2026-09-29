import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    buildVolcengineSignedRequest,
    createSeedancePortraitAsset,
    createSeedanceTaskWithAssetRecovery,
    createSeedanceVisualValidationSession,
    getSeedanceAssetLibraryConfig,
    getSeedancePortraitAssetStatus,
    getSeedanceVisualValidationResult,
    isSeedancePrivacyInformationError,
    SEEDANCE_PRIVACY_ERROR_CODE,
    type SeedanceAssetLibraryConfig
} from './seedance-assets'

const seedanceConfig = {
    apiKey: 'ark-api-key',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    modelName: 'doubao-seedance-2-0-260128',
    extra: JSON.stringify({
        assetLibrary: {
            accessKeyId: 'AKIDEXAMPLE',
            secretAccessKey: 'secret-example',
            projectName: 'default',
            assetGroupId: 'group-existing',
            aigcAssetGroupId: 'group-studio-existing'
        }
    })
}

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('Seedance material-library recovery', () => {
    it('recognizes only the documented privacy-information code', () => {
        expect(
            isSeedancePrivacyInformationError(
                JSON.stringify({
                    error: { code: SEEDANCE_PRIVACY_ERROR_CODE }
                })
            )
        ).toBe(true)
        expect(
            isSeedancePrivacyInformationError(
                JSON.stringify({
                    error: { code: 'InputImageSensitiveContentDetected.Other' }
                })
            )
        ).toBe(false)
    })

    it('reads existing credentials from Seedance extra config without changing the API key', () => {
        expect(getSeedanceAssetLibraryConfig(seedanceConfig)).toMatchObject({
            accessKeyId: 'AKIDEXAMPLE',
            secretAccessKey: 'secret-example',
            projectName: 'default',
            groupId: 'group-existing'
        })
        expect(seedanceConfig.apiKey).toBe('ark-api-key')
    })

    it('requires environment or explicitly supplied credentials instead of hard-coded keys', () => {
        for (const name of [
            'VOLCENGINE_ACCESS_KEY',
            'VOLCSTACK_ACCESS_KEY_ID',
            'VOLCSTACK_ACCESS_KEY',
            'ARK_ACCESS_KEY_ID',
            'VOLCENGINE_SECRET_KEY',
            'VOLCSTACK_SECRET_ACCESS_KEY',
            'VOLCSTACK_SECRET_KEY',
            'ARK_SECRET_ACCESS_KEY'
        ])
            vi.stubEnv(name, '')
        expect(getSeedanceAssetLibraryConfig({ ...seedanceConfig, extra: null })).toBeNull()
    })

    it('loads asset-library credentials from the environment', () => {
        vi.stubEnv('VOLCENGINE_ACCESS_KEY', 'deployment-access-key')
        vi.stubEnv('VOLCENGINE_SECRET_KEY', 'deployment-secret-key')
        vi.stubEnv('SEEDANCE_ASSET_GROUP_ID', 'deployment-group')

        expect(
            getSeedanceAssetLibraryConfig({
                ...seedanceConfig,
                extra: null
            })
        ).toMatchObject({
            accessKeyId: 'deployment-access-key',
            secretAccessKey: 'deployment-secret-key',
            groupId: 'deployment-group'
        })
    })

    it('does not reuse the built-in moviebox group for another configured project', () => {
        vi.stubEnv('VOLCENGINE_ACCESS_KEY', 'deployment-access-key')
        vi.stubEnv('VOLCENGINE_SECRET_KEY', 'deployment-secret-key')
        vi.stubEnv('SEEDANCE_PROJECT_NAME', 'another-project')

        expect(
            getSeedanceAssetLibraryConfig({
                ...seedanceConfig,
                extra: null
            })
        ).toMatchObject({
            projectName: 'another-project',
            groupId: undefined
        })
    })

    it('builds the documented Ark OpenAPI action and HMAC-SHA256 headers', () => {
        const config: SeedanceAssetLibraryConfig = {
            accessKeyId: 'AKIDEXAMPLE',
            secretAccessKey: 'secret-example',
            projectName: 'default',
            groupId: 'group-existing',
            groupName: 'group',
            region: 'cn-beijing',
            endpoint: 'https://ark.cn-beijing.volcengineapi.com'
        }
        const signed = buildVolcengineSignedRequest(
            'CreateAsset',
            {
                GroupId: 'group-existing',
                URL: 'https://example.com/frame.png',
                AssetType: 'Image',
                ProjectName: 'default'
            },
            config,
            new Date('2026-07-27T01:02:03.000Z')
        )

        expect(signed.url).toBe('https://ark.cn-beijing.volcengineapi.com/?Action=CreateAsset&Version=2024-01-01')
        expect(signed.headers['X-Date']).toBe('20260727T010203Z')
        expect(signed.headers.Authorization).toContain('HMAC-SHA256 Credential=AKIDEXAMPLE/20260727/cn-beijing/ark/request')
        expect(signed.headers.Authorization).toContain('SignedHeaders=content-type;host;x-content-sha256;x-date')
    })

    it('discovers the endpoint project and creates a one-time portrait validation session', async () => {
        const calls: Array<{ action: string | null; body: Record<string, unknown> }> = []
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input))
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
            calls.push({ action: url.searchParams.get('Action'), body })
            if (url.searchParams.get('Action') === 'GetEndpoint') {
                return new Response(JSON.stringify({ Result: { Id: 'ep-portrait-test', ProjectName: 'moviebox' } }))
            }
            return new Response(
                JSON.stringify({
                    Result: {
                        BytedToken: 'token-once',
                        H5Link: 'https://ark.example.com/portrait-auth',
                        CallbackURL: 'https://app.example.com/api/callback'
                    }
                })
            )
        }) as typeof fetch

        const result = await createSeedanceVisualValidationSession({ ...seedanceConfig, modelName: 'ep-portrait-test' }, 'https://app.example.com/api/callback', { fetchImpl })

        expect(result).toMatchObject({
            bytedToken: 'token-once',
            h5Link: 'https://ark.example.com/portrait-auth',
            projectName: 'moviebox'
        })
        expect(calls).toEqual([
            { action: 'GetEndpoint', body: { Id: 'ep-portrait-test' } },
            {
                action: 'CreateVisualValidateSession',
                body: { CallbackURL: 'https://app.example.com/api/callback', ProjectName: 'moviebox' }
            }
        ])
    })

    it('exchanges the validation token for a portrait group and returns each uploaded asset ID', async () => {
        const actions: string[] = []
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input))
            const action = url.searchParams.get('Action') ?? ''
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
            actions.push(action)
            if (action === 'GetEndpoint') return new Response(JSON.stringify({ Result: { ProjectName: 'moviebox' } }))
            if (action === 'GetVisualValidateResult') {
                expect(body).toMatchObject({ BytedToken: 'token-once', ProjectName: 'moviebox' })
                return new Response(JSON.stringify({ Result: { GroupId: 'group-real-person' } }))
            }
            if (action === 'CreateAsset') {
                expect(body).toMatchObject({
                    GroupId: 'group-real-person',
                    URL: 'https://example.com/front.png',
                    AssetType: 'Image',
                    ProjectName: 'moviebox'
                })
                return new Response(JSON.stringify({ Result: { Id: 'asset-front' } }))
            }
            throw new Error(`Unexpected action ${action}`)
        }) as typeof fetch
        const config = { ...seedanceConfig, modelName: 'ep-portrait-exchange-test' }

        await expect(getSeedanceVisualValidationResult(config, 'token-once', { fetchImpl })).resolves.toEqual({
            groupId: 'group-real-person',
            projectName: 'moviebox'
        })
        await expect(
            createSeedancePortraitAsset(
                config,
                {
                    groupId: 'group-real-person',
                    sourceUrl: 'https://example.com/front.png',
                    name: 'front'
                },
                { fetchImpl }
            )
        ).resolves.toEqual({ assetId: 'asset-front', projectName: 'moviebox' })
        expect(actions).toEqual(['GetEndpoint', 'GetVisualValidateResult', 'CreateAsset'])
    })

    it('checks asset usability in the same project as the inference endpoint', async () => {
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input))
            const action = url.searchParams.get('Action')
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
            if (action === 'GetEndpoint') return new Response(JSON.stringify({ Result: { ProjectName: 'moviebox' } }))
            expect(body).toEqual({ Id: 'asset-ready', ProjectName: 'moviebox' })
            return new Response(
                JSON.stringify({
                    Result: {
                        Id: 'asset-ready',
                        GroupId: 'group-real-person',
                        ProjectName: 'moviebox',
                        Status: 'Active'
                    }
                })
            )
        }) as typeof fetch

        await expect(getSeedancePortraitAssetStatus({ ...seedanceConfig, modelName: 'ep-portrait-status-test' }, 'asset-ready', { fetchImpl })).resolves.toEqual({
            assetId: 'asset-ready',
            groupId: 'group-real-person',
            projectName: 'moviebox',
            status: 'Active'
        })
    })

    it('uploads fictional frames to the official AIGC group, waits for Active, and retries with asset URIs', async () => {
        const calls: Array<{ url: string; body: Record<string, unknown> }> = []
        let generationAttempt = 0
        let createdAsset = 0
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
            calls.push({ url, body })
            if (url.includes('/api/v3/contents/generations/tasks')) {
                generationAttempt += 1
                if (generationAttempt === 1) {
                    return new Response(
                        JSON.stringify({
                            error: { code: SEEDANCE_PRIVACY_ERROR_CODE, message: 'input image may contain real person' }
                        }),
                        { status: 400 }
                    )
                }
                return new Response(JSON.stringify({ id: 'task-retried' }), { status: 200 })
            }
            if (url.includes('Action=CreateAsset')) {
                createdAsset += 1
                expect(body.GroupId).toBe('group-studio-existing')
                return new Response(JSON.stringify({ Result: { Id: `asset-uploaded-${createdAsset}` } }), { status: 200 })
            }
            if (url.includes('Action=GetAsset')) {
                return new Response(JSON.stringify({ Result: { Status: 'Active' } }), { status: 200 })
            }
            throw new Error(`Unexpected request: ${url}`)
        }) as typeof fetch

        const result = await createSeedanceTaskWithAssetRecovery({
            baseUrl: 'https://ark.cn-beijing.volces.com',
            apiKey: seedanceConfig.apiKey,
            seedanceConfig,
            requestBody: {
                model: seedanceConfig.modelName,
                content: [
                    { type: 'text', text: 'test' },
                    { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'first_frame' },
                    { type: 'image_url', image_url: { url: 'https://example.com/last.png' }, role: 'last_frame' }
                ]
            },
            fetchImpl,
            sleepImpl: async () => {}
        })

        expect(result.taskId).toBe('task-retried')
        expect(result.recovery?.assetIds).toEqual(['asset-uploaded-1', 'asset-uploaded-2'])
        expect(result.requestBody.content).toEqual([
            { type: 'text', text: 'test' },
            { type: 'image_url', image_url: { url: 'asset://asset-uploaded-1' }, role: 'first_frame' },
            { type: 'image_url', image_url: { url: 'asset://asset-uploaded-2' }, role: 'last_frame' }
        ])
        expect(generationAttempt).toBe(2)
        expect(calls.filter(call => call.url.includes('Action=CreateAsset'))).toHaveLength(2)
        expect(calls.filter(call => call.url.includes('Action=GetAsset'))).toHaveLength(2)
    })

    it.each([
        ['Seedance', 'ep-configure-1'],
        ['Seedance 2.5', 'ep-configure-2']
    ])('keeps the selected %s endpoint while retrying through the endpoint project AIGC library', async (_label, modelName) => {
        const requestBodies: Array<Record<string, unknown>> = []
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
            if (url.includes('/api/v3/contents/generations/tasks')) {
                requestBodies.push(body)
                return requestBodies.length === 1
                    ? new Response(JSON.stringify({ error: { code: SEEDANCE_PRIVACY_ERROR_CODE } }), { status: 400 })
                    : new Response(JSON.stringify({ id: 'task-recovered' }), { status: 200 })
            }
            if (url.includes('Action=GetEndpoint')) {
                expect(body).toEqual({ Id: modelName })
                return new Response(JSON.stringify({ Result: { ProjectName: 'default' } }), { status: 200 })
            }
            if (url.includes('Action=CreateAsset')) {
                expect(body).toMatchObject({ GroupId: 'group-studio-existing', ProjectName: 'default' })
                return new Response(JSON.stringify({ Result: { Id: 'asset-uploaded' } }), { status: 200 })
            }
            if (url.includes('Action=GetAsset')) {
                return new Response(JSON.stringify({ Result: { Status: 'Active' } }), { status: 200 })
            }
            throw new Error(`Unexpected request: ${url}`)
        }) as typeof fetch

        const result = await createSeedanceTaskWithAssetRecovery({
            baseUrl: 'https://ark.cn-beijing.volces.com',
            apiKey: seedanceConfig.apiKey,
            seedanceConfig: { ...seedanceConfig, modelName },
            requestBody: {
                model: modelName,
                content: [
                    { type: 'text', text: 'test' },
                    { type: 'image_url', image_url: { url: `https://example.com/${modelName}.png` }, role: 'reference_image' }
                ]
            },
            fetchImpl,
            sleepImpl: async () => {}
        })

        expect(requestBodies.map(body => body.model)).toEqual([modelName, modelName])
        expect(result.requestBody.model).toBe(modelName)
        expect(result.requestBody.content).toEqual([
            { type: 'text', text: 'test' },
            { type: 'image_url', image_url: { url: 'asset://asset-uploaded' }, role: 'reference_image' }
        ])
    })

    it('does not invoke the material API or retry for unrelated errors', async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        error: { code: 'InvalidParameter', message: 'bad request' }
                    }),
                    { status: 400 }
                )
        ) as typeof fetch

        await expect(
            createSeedanceTaskWithAssetRecovery({
                baseUrl: 'https://ark.cn-beijing.volces.com',
                apiKey: seedanceConfig.apiKey,
                seedanceConfig,
                requestBody: { content: [] },
                fetchImpl
            })
        ).rejects.toThrow('InvalidParameter')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('does not ask for真人认证 when the rejected task has no uploadable frame', async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        error: { code: SEEDANCE_PRIVACY_ERROR_CODE, param: 'content[1]' }
                    }),
                    { status: 400 }
                )
        ) as typeof fetch

        await expect(
            createSeedanceTaskWithAssetRecovery({
                baseUrl: 'https://ark.cn-beijing.volces.com',
                apiKey: seedanceConfig.apiKey,
                seedanceConfig,
                requestBody: {
                    content: [{ type: 'text', text: 'keep the character description and action' }]
                },
                fetchImpl
            })
        ).rejects.toThrow('没有可上传到官方素材库的 HTTP(S) 分镜图片')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('creates an AIGC group instead of entering the live-person authentication flow', async () => {
        let generationAttempt = 0
        const actions: string[] = []
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input))
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
            if (url.pathname.includes('/api/v3/contents/generations/tasks')) {
                generationAttempt += 1
                return generationAttempt === 1
                    ? new Response(JSON.stringify({ error: { code: SEEDANCE_PRIVACY_ERROR_CODE } }), { status: 400 })
                    : new Response(JSON.stringify({ id: 'task-after-upload' }), { status: 200 })
            }
            const action = url.searchParams.get('Action') ?? ''
            actions.push(action)
            if (action === 'ListAssetGroups') return new Response(JSON.stringify({ Result: { Items: [] } }), { status: 200 })
            if (action === 'CreateAssetGroup') {
                expect(body).toMatchObject({ GroupType: 'AIGC', ProjectName: 'default' })
                return new Response(JSON.stringify({ Result: { Id: 'group-created-aigc' } }), { status: 200 })
            }
            if (action === 'CreateAsset') return new Response(JSON.stringify({ Result: { Id: 'asset-created-aigc' } }), { status: 200 })
            if (action === 'GetAsset') return new Response(JSON.stringify({ Result: { Status: 'Active' } }), { status: 200 })
            throw new Error(`Unexpected request: ${url}`)
        }) as typeof fetch

        const result = await createSeedanceTaskWithAssetRecovery({
            baseUrl: 'https://ark.cn-beijing.volces.com',
            apiKey: seedanceConfig.apiKey,
            seedanceConfig: {
                ...seedanceConfig,
                extra: JSON.stringify({
                    assetLibrary: {
                        accessKeyId: 'AKIDEXAMPLE',
                        secretAccessKey: 'secret-example',
                        projectName: 'default',
                        groupName: 'fictional-test-group'
                    }
                })
            },
            requestBody: {
                content: [{ type: 'image_url', image_url: { url: 'https://example.com/create-group.png' }, role: 'first_frame' }]
            },
            fetchImpl,
            sleepImpl: async () => {}
        })

        expect(result.recovery?.assetIds).toEqual(['asset-created-aigc'])
        expect(result.requestBody.content).toEqual([{ type: 'image_url', image_url: { url: 'asset://asset-created-aigc' }, role: 'first_frame' }])
        expect(actions).toEqual(['ListAssetGroups', 'CreateAssetGroup', 'CreateAsset', 'GetAsset'])
        expect(actions).not.toContain('CreateVisualValidateSession')
    })

    it('does not ask for真人认证 when the provider still rejects an uploaded AIGC asset', async () => {
        let generationAttempt = 0
        const fetchImpl = vi.fn(async (input: string | URL | Request) => {
            const url = String(input)
            if (url.includes('/api/v3/contents/generations/tasks')) {
                generationAttempt += 1
                return generationAttempt === 1
                    ? new Response(JSON.stringify({ error: { code: SEEDANCE_PRIVACY_ERROR_CODE } }), { status: 400 })
                    : new Response(JSON.stringify({ error: { code: SEEDANCE_PRIVACY_ERROR_CODE } }), { status: 400 })
            }
            if (url.includes('Action=CreateAsset')) return new Response(JSON.stringify({ Result: { Id: 'asset-rejected' } }), { status: 200 })
            if (url.includes('Action=GetAsset')) return new Response(JSON.stringify({ Result: { Status: 'Active' } }), { status: 200 })
            throw new Error(`Unexpected request: ${url}`)
        }) as typeof fetch

        const task = createSeedanceTaskWithAssetRecovery({
            baseUrl: 'https://ark.cn-beijing.volces.com',
            apiKey: seedanceConfig.apiKey,
            seedanceConfig,
            requestBody: {
                content: [{ type: 'image_url', image_url: { url: 'https://example.com/still-rejected.png' }, role: 'first_frame' }]
            },
            fetchImpl,
            sleepImpl: async () => {}
        })
        await expect(task).rejects.toThrow('无需真人认证')
        await expect(task).rejects.not.toThrow('项目“角色”页面')
    })
})
