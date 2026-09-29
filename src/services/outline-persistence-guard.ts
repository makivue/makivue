import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

/** Reset and outline checkpoints must share a lock, including the final setup write. */
export async function withActiveOutlineWrite<T>(projectId: bigint, operationVersion: number, jobId: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(
        async tx => {
            await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
            const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationVersion: true, deletedAt: true } })
            const job = await tx.outlineJob.findFirst({ where: { id: BigInt(jobId), projectId, phase: { in: ['generating', 'filling', 'writing_db'] } }, select: { id: true } })
            if (!project || project.deletedAt || project.operationVersion !== operationVersion || !job) throw new Error('大纲任务已失效，停止写入')
            return write(tx)
        },
        { timeout: 60_000 }
    )
}
