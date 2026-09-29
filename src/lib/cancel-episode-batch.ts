import { prisma } from '@/lib/prisma'
import { cancelEpJob, type EpJob } from '@/lib/episodeJobStore'
import { parseApiIds } from '@/lib/api-id'

export async function cancelEpisodeBatchJob(job: EpJob): Promise<void> {
    await cancelEpJob(job.id)

    const storyboardIds = parseApiIds(job.shots.map(shot => shot.storyboardId))
    if (!storyboardIds) throw new Error('任务数据中的分镜 ID 无效，请重新发起生成')

    await prisma.$transaction(async tx => {
        const storyboards = await tx.storyboard.findMany({
            where: { id: { in: storyboardIds }, deletedAt: null },
            select: { id: true, firstFrameUrl: true, lastFrameUrl: true, plannedLastFrameUrl: true, videoUrl: true, frameStatus: true, videoStatus: true, operationVersion: true }
        })
        // 排队任务可以立即取消；已经发给模型的请求要保留 processing 槽位，
        // 直到请求真正中断或返回。否则用户马上重启批次时，新旧请求会叠加。
        await tx.generation.updateMany({
            where: { storyboardId: { in: storyboardIds }, status: 'queued' },
            data: { status: 'cancelled', activeKey: null, errorMsg: '已取消' }
        })
        await tx.generation.updateMany({
            where: { storyboardId: { in: storyboardIds }, status: 'processing' },
            data: { errorMsg: '任务已暂停，该镜头尚未完成' }
        })
        for (const storyboard of storyboards) {
            const data: { frameStatus?: string; videoStatus?: string; operationVersion: { increment: number } } = {
                operationVersion: { increment: 1 }
            }
            if (storyboard.frameStatus === 'generating') {
                data.frameStatus = storyboard.firstFrameUrl || storyboard.plannedLastFrameUrl || storyboard.lastFrameUrl ? 'completed' : 'pending'
            }
            if (storyboard.videoStatus === 'generating') data.videoStatus = storyboard.videoUrl ? 'completed' : 'pending'
            await tx.storyboard.updateMany({
                where: { id: storyboard.id, deletedAt: null, operationVersion: storyboard.operationVersion },
                data
            })
        }
    })
}
