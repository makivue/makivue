import { PrismaClient } from '@/generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { databaseUrlFromEnvironment } from '../../scripts/database-environment.mjs'

function parseMysqlUrl(url: string) {
    const u = new URL(url)
    return {
        host: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port ? parseInt(u.port, 10) : 3306,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: decodeURIComponent(u.pathname.replace(/^\//, ''))
    }
}

function createPrismaClient() {
    const url = databaseUrlFromEnvironment()
    if (!url) throw new Error('DATABASE_URL is not set')
    // 默认 mariadb pool 只有 10 连接，10+ 并发请求（例如打开分镜页 40 张卡）会全部堵在获取连接上，
    // 表现为 Node 进程内 promise 卡死 → nginx 侧看到 upstream 提前断开 / 500 空 body。
    // 允许通过 env 覆盖，默认放宽到 50。
    const connectionLimit = Number(process.env.MYSQL_CONNECTION_LIMIT || 50)
    const acquireTimeout = Number(process.env.MYSQL_ACQUIRE_TIMEOUT || 10_000)
    const connectTimeout = Number(process.env.MYSQL_CONNECT_TIMEOUT || 3_000)
    const adapter = new PrismaMariaDb({
        ...parseMysqlUrl(url),
        connectionLimit,
        acquireTimeout,
        connectTimeout
    })
    return new PrismaClient({ adapter })
}

type PrismaClientInstance = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientInstance }

// Lazy Proxy: defer client creation to first-use so `next build` (which imports
// this module during "collect page data") doesn't fail when DATABASE_URL is
// only injected at container startup.
export const prisma: PrismaClientInstance = new Proxy({} as PrismaClientInstance, {
    get(_target, prop, receiver) {
        const client = (globalForPrisma.prisma ??= createPrismaClient())
        const value = Reflect.get(client as unknown as object, prop, receiver)
        return typeof value === 'function' ? value.bind(client) : value
    }
})
