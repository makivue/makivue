import { parseApiId } from './api-id'

export const CREATOR_MERGE_MAX_CLIPS = 20
export const CREATOR_MERGE_MAX_SECONDS = 600
export type CreatorMergeRatio = '16:9' | '9:16' | '1:1' | '21:9'
export interface CreatorMergeInput {
    assetIds: string[]
    ratio: CreatorMergeRatio
    title: string
    requestKey: string
}

export function parseCreatorMergeInput(raw: unknown): CreatorMergeInput {
    if (!raw || typeof raw !== 'object') throw new Error('拼接参数无效')
    const value = raw as Record<string, unknown>
    if (!Array.isArray(value.assetIds) || value.assetIds.length < 2 || value.assetIds.length > CREATOR_MERGE_MAX_CLIPS) throw new Error('请选择 2–20 个视频片段')
    if (value.assetIds.some(id => typeof id !== 'string' || parseApiId(id) === null)) throw new Error('视频片段编号无效')
    const assetIds = (value.assetIds as string[]).map(id => BigInt(id).toString())
    if (new Set(assetIds).size !== assetIds.length) throw new Error('视频片段不能重复选择')
    if (typeof value.ratio !== 'string' || !['16:9', '9:16', '1:1', '21:9'].includes(value.ratio)) throw new Error('不支持的视频比例')
    const title = typeof value.title === 'string' ? value.title.trim() : ''
    if (!title || title.length > 120) throw new Error('请输入 1–120 字的成片标题')
    if (typeof value.requestKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestKey)) throw new Error('拼接请求编号无效')
    return { assetIds, ratio: value.ratio as CreatorMergeRatio, title, requestKey: value.requestKey }
}
