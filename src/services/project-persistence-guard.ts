import { localTransactionLock } from '@/lib/local-store'
import type { Prisma } from '@/generated/prisma/client'

/** Generated project content must use the revision that started the job. */
export async function lockProjectGenerationSource(tx: Prisma.TransactionClient, source: { id: bigint; operationVersion: number }) {
    await localTransactionLock('project-generation-source')
    const current = await tx.project.findUnique({ where: { id: source.id }, select: { operationVersion: true, deletedAt: true } })
    if (!current || current.deletedAt || current.operationVersion !== source.operationVersion) {
        throw new Error('生成期间内容已修改，本次结果未覆盖新版本，请基于最新内容重试')
    }
}
