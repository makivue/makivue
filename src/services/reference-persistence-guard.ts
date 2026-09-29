import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

type ReferenceSource = { type: 'character' | 'scene'; id: bigint; projectId: bigint; operationVersion: number }

export class StaleReferenceMutationError extends Error {
    constructor() {
        super('角色或场景已变化，请刷新后重试；旧参考图未写入')
    }
}

export async function lockCurrentReferenceInTransaction(tx: Prisma.TransactionClient, source: ReferenceSource) {

    const project = await tx.project.findFirst({ where: { id: source.projectId, deletedAt: null }, select: { operationVersion: true } })
    const query = { where: { id: source.id }, select: { projectId: true, deletedAt: true, operationVersion: true } }
    const target = source.type === 'character' ? await tx.character.findUnique(query) : await tx.scene.findUnique(query)
    if (!project || !target || target.deletedAt || target.projectId !== source.projectId || target.operationVersion !== source.operationVersion) throw new StaleReferenceMutationError()
    return project
}

export async function withActiveReferenceWrite<T>(source: ReferenceSource & { jobId: string; projectOperationVersion: number }, write: (tx: Prisma.TransactionClient) => Promise<T>) {
    return prisma.$transaction(
        async tx => {
            const project = await lockCurrentReferenceInTransaction(tx, source)

            const job = await tx.refImageJob.findFirst({
                where: { id: BigInt(source.jobId), targetType: source.type, targetId: source.id, projectId: source.projectId, phase: { in: ['generating', 'running', 'writing_db'] } },
                select: { id: true }
            })
            if (!job || project.operationVersion !== source.projectOperationVersion) throw new StaleReferenceMutationError()
            return write(tx)
        },
        { timeout: 60_000 }
    )
}
