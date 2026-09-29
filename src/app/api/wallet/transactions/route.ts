import { walletTransactionDestinations } from '@/services/wallet-transaction-destinations'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { wholePointAmount, wholePointBalance } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse, handleApiError } from '@/lib/utils'

const PAGE_SIZE = 30

type TransactionCursor = {
    createdAt: Date
    id: bigint
}

function encodeCursor(cursor: TransactionCursor): string {
    return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id.toString()])).toString('base64url')
}

function decodeCursor(value: string): TransactionCursor | null {
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
        if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null
        const createdAt = new Date(parsed[0])
        const id = parseApiId(parsed[1])
        if (Number.isNaN(createdAt.getTime()) || id === null) return null
        return { createdAt, id }
    } catch {
        return null
    }
}

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录后查看账户流水', 401)

    const rawCursor = req.nextUrl.searchParams.get('cursor')
    const cursor = rawCursor ? decodeCursor(rawCursor) : null
    if (rawCursor && !cursor) return apiError('分页参数无效')

    try {
        const rows = await prisma.walletTransaction.findMany({
            where: {
                userId,
                ...(cursor
                    ? {
                          OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }]
                      }
                    : {})
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PAGE_SIZE + 1
        })
        const page = rows.slice(0, PAGE_SIZE)
        const destinations = await walletTransactionDestinations(userId, page)
        const last = page.at(-1)

        return apiResponse({
            transactions: page.map(transaction => ({
                id: transaction.id.toString(),
                type: transaction.type,
                amountPoints: wholePointAmount(Number(transaction.amountPoints)),
                balanceAfterPoints: wholePointBalance(Number(transaction.balanceAfterPoints)),
                status: transaction.status,
                sourceType: transaction.sourceType,
                sourceId: transaction.sourceId,
                destinationPath: destinations.get(`${transaction.sourceType}:${transaction.sourceId}`) ?? null,
                description: transaction.description,
                createdAt: transaction.createdAt.toISOString()
            })),
            nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null
        })
    } catch (error) {
        console.error('[wallet-transactions] failed to load wallet transactions', error)
        return handleApiError(error, '账户流水加载失败')
    }
}
