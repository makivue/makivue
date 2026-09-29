import { prisma } from '@/lib/prisma'

let cache: { enabled: boolean; expiresAt: number } | null = null

export async function isSafetyDiagnosticsEnabled() {
    if (cache && cache.expiresAt > Date.now()) return cache.enabled

    const config = await prisma.aiServiceConfig.findUnique({
        where: { provider: 'safety_diagnostics' },
        select: { modelName: true }
    })
    const enabled = config?.modelName === 'enabled'
    cache = { enabled, expiresAt: Date.now() + 10_000 }
    return enabled
}
