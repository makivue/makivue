import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { createSeedancePortraitAsset, getSeedancePortraitAssetStatus } from './seedance-assets'
import { getSeedanceConfig, type SeedanceConfig } from './seedance-config'

const PORTRAIT_REFERENCE_ROLES = ['face', 'turnaround_sheet', 'full_body'] as const

function isUniqueConstraintError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002'
}

function rolePriority(role: string | null): number {
    if (role === 'face') return 0
    if (role === 'turnaround_sheet') return 1
    if (role === 'full_body') return 2
    return 3
}

async function requireSeedanceConfig(): Promise<SeedanceConfig> {
    const config = await getSeedanceConfig()
    if (!config?.apiKey) throw new Error('视频生成人像认证配置不可用，请联系管理员')
    return config
}

export async function submitCharacterSeedancePortraitAsset(
    characterId: bigint,
    input: { sourceUrl: string; role: 'face' | 'turnaround_sheet' | 'full_body'; name?: string },
    suppliedConfig?: SeedanceConfig
): Promise<{ status: 'created' | 'skipped' | 'failed'; error?: string }> {
    const character = await prisma.character.findFirst({
        where: { id: characterId, deletedAt: null },
        select: { name: true, seedanceAssetGroupId: true, seedancePortraitStatus: true }
    })
    if (!character) throw new Error('角色不存在')
    if (!character.seedanceAssetGroupId || character.seedancePortraitStatus !== 'authorized') {
        throw new Error('请先完成真人认证，再上传角色素材')
    }

    let row = await prisma.seedancePortraitAsset.findUnique({
        where: {
            characterId_groupId_sourceUrl: {
                characterId,
                groupId: character.seedanceAssetGroupId,
                sourceUrl: input.sourceUrl
            }
        }
    })
    if (row && ['uploading', 'processing', 'active'].includes(row.status)) return { status: 'skipped' }

    if (row) {
        const claimed = await prisma.seedancePortraitAsset.updateMany({
            where: { id: row.id, status: 'failed' },
            data: { status: 'uploading', assetId: null, errorMsg: null, role: input.role }
        })
        if (claimed.count !== 1) return { status: 'skipped' }
    } else {
        try {
            row = await prisma.seedancePortraitAsset.create({
                data: {
                    id: genId(),
                    characterId,
                    groupId: character.seedanceAssetGroupId,
                    projectName: 'pending',
                    role: input.role,
                    sourceUrl: input.sourceUrl,
                    name: (input.name || `${character.name}-${input.role}-${Date.now()}`).slice(0, 255),
                    status: 'uploading'
                }
            })
        } catch (error) {
            if (isUniqueConstraintError(error)) return { status: 'skipped' }
            throw error
        }
    }

    try {
        const config = suppliedConfig ?? (await requireSeedanceConfig())
        const remote = await createSeedancePortraitAsset(config, {
            groupId: character.seedanceAssetGroupId,
            sourceUrl: input.sourceUrl,
            name: row.name
        })
        await prisma.seedancePortraitAsset.update({
            where: { id: row.id },
            data: {
                assetId: remote.assetId,
                projectName: remote.projectName,
                status: 'processing',
                errorMsg: null
            }
        })
        return { status: 'created' }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await prisma.seedancePortraitAsset.update({
            where: { id: row.id },
            data: { status: 'failed', errorMsg: message }
        })
        return { status: 'failed', error: message }
    }
}

export async function syncCharacterSeedancePortraitAssets(characterId: bigint, suppliedConfig?: SeedanceConfig): Promise<{ created: number; skipped: number; failed: number }> {
    const character = await prisma.character.findFirst({
        where: { id: characterId, deletedAt: null },
        select: {
            id: true,
            name: true,
            seedanceAssetGroupId: true,
            seedancePortraitStatus: true,
            referenceImageUrl: true,
            referenceAssetRows: {
                where: {
                    deletedAt: null,
                    status: 'selected',
                    role: { in: [...PORTRAIT_REFERENCE_ROLES] }
                },
                select: { role: true, url: true },
                orderBy: { updatedAt: 'desc' }
            }
        }
    })
    if (!character) throw new Error('角色不存在')
    if (!character.seedanceAssetGroupId || character.seedancePortraitStatus !== 'authorized') {
        throw new Error('请先完成真人认证，再同步角色素材')
    }

    const byRole = new Map<string, string>()
    for (const item of character.referenceAssetRows) {
        if (!byRole.has(item.role)) byRole.set(item.role, item.url)
    }
    if (!byRole.has('turnaround_sheet') && character.referenceImageUrl) byRole.set('turnaround_sheet', character.referenceImageUrl)
    const references = [...byRole.entries()]
    if (!references.length) throw new Error('请先定稿多视图角色设定板或面部特写，再同步真人素材')

    let created = 0
    let skipped = 0
    let failed = 0

    for (const [role, sourceUrl] of references) {
        const result = await submitCharacterSeedancePortraitAsset(characterId, { sourceUrl, role: role as 'face' | 'turnaround_sheet' | 'full_body' }, suppliedConfig)
        if (result.status === 'created') created += 1
        else if (result.status === 'failed') failed += 1
        else skipped += 1
    }

    return { created, skipped, failed }
}

export async function refreshCharacterSeedancePortraitAssets(characterId: bigint, suppliedConfig?: SeedanceConfig): Promise<void> {
    const pending = await prisma.seedancePortraitAsset.findMany({
        where: {
            characterId,
            status: 'processing',
            assetId: { not: null }
        },
        orderBy: { createdAt: 'asc' },
        take: 10
    })
    if (pending.length) {
        const config = suppliedConfig ?? (await requireSeedanceConfig())
        for (const item of pending) {
            if (!item.assetId) continue
            try {
                const remote = await getSeedancePortraitAssetStatus(config, item.assetId)
                const remoteStatus = remote.status.trim().toLowerCase()
                const status = ['active', 'succeeded', 'success', 'published', 'available'].includes(remoteStatus)
                    ? 'active'
                    : ['failed', 'rejected', 'error'].includes(remoteStatus)
                      ? 'failed'
                      : 'processing'
                await prisma.seedancePortraitAsset.update({
                    where: { id: item.id },
                    data: {
                        status,
                        projectName: remote.projectName,
                        errorMsg: status === 'failed' ? '真人素材一致性校验未通过，请更换清晰正面素材后重试' : null
                    }
                })
            } catch (error) {
                console.warn('[seedance-portrait] asset status refresh failed:', error instanceof Error ? error.message : String(error))
            }
        }
    }

    const active = await prisma.seedancePortraitAsset.findMany({
        where: { characterId, status: 'active', assetId: { not: null } },
        select: { assetId: true, role: true, updatedAt: true }
    })
    active.sort((left, right) => rolePriority(left.role) - rolePriority(right.role) || right.updatedAt.getTime() - left.updatedAt.getTime())
    const primaryAssetId = active[0]?.assetId ?? null
    if (primaryAssetId) {
        await prisma.character.updateMany({
            where: { id: characterId, deletedAt: null },
            data: { seedanceAssetId: primaryAssetId, seedancePortraitStatus: 'authorized' }
        })
    }
}
