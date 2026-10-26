import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { isUploadedDrama, uploadedDramaCast, uploadedDramaSource } from '@/lib/uploaded-drama'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'

export const runtime = 'nodejs'
type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const id = parseApiId((await params).id)
    if (id === null) return apiError('作品 ID 格式无效', 400)
    try {
        const project = await prisma.project.findFirst({
            where: { id, userId, deletedAt: null },
            select: {
                id: true,
                title: true,
                description: true,
                genre: true,
                coverUrl: true,
                contentLanguage: true,
                subtitleLanguages: true,
                visibility: true,
                createdAt: true,
                sourceAnswers: true,
                episodes: {
                    where: { deletedAt: null },
                    orderBy: { episodeNumber: 'asc' },
                    select: {
                        id: true,
                        episodeNumber: true,
                        title: true,
                        videoUrl: true,
                        merges: { orderBy: { createdAt: 'desc' }, select: { videoUrl: true, subtitleUrls: true, duration: true } }
                    }
                }
            }
        })
        if (!project || !isUploadedDrama(project.sourceAnswers)) return apiError('上传作品不存在', 404)
        const source = uploadedDramaSource(project.sourceAnswers)
        return apiResponse({
            id: project.id,
            title: project.title,
            description: project.description,
            genre: project.genre,
            coverUrl: project.coverUrl,
            contentLanguage: project.contentLanguage,
            subtitleLanguages: project.subtitleLanguages,
            visibility: project.visibility,
            createdAt: project.createdAt,
            year: typeof source.year === 'number' ? source.year : null,
            cast: uploadedDramaCast(source.cast),
            episodes: project.episodes.map(episode => ({ ...episode, duration: episode.merges.find(merge => merge.videoUrl === episode.videoUrl)?.duration ?? null }))
        })
    } catch (error) {
        console.error('Failed to load uploaded drama:', error)
        return apiError('上传作品暂时无法加载，请稍后重试', 503)
    }
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const id = parseApiId((await params).id)
    if (id === null) return apiError('作品 ID 格式无效', 400)
    try {
        const project = await prisma.project.findFirst({ where: { id, userId, deletedAt: null }, select: { sourceAnswers: true } })
        if (!project || !isUploadedDrama(project.sourceAnswers)) return apiError('上传作品不存在', 404)
        const result = await prisma.project.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } })
        if (!result.count) return apiError('上传作品不存在', 404)
        return apiResponse({ id })
    } catch (error) {
        console.error('Failed to delete uploaded drama:', error)
        return apiError('删除失败', 503)
    }
}
