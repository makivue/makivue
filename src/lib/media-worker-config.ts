const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no'])

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function durableMediaWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return !DISABLED_VALUES.has(env.ENABLE_DURABLE_MEDIA_WORKER?.trim().toLowerCase() ?? '')
}

export function projectImportWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return !DISABLED_VALUES.has(env.ENABLE_PROJECT_IMPORT_WORKER?.trim().toLowerCase() ?? '')
}

export function ffmpegRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
    const allowedPresets = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
    const configuredPreset = env.FFMPEG_PRESET?.trim().toLowerCase()

    return {
        concurrency: boundedInteger(env.FFMPEG_CONCURRENCY, 1, 1, 4),
        threads: boundedInteger(env.FFMPEG_THREADS, 2, 1, 16),
        preset: configuredPreset && allowedPresets.has(configuredPreset) ? configuredPreset : 'fast',
        clusterConcurrency: boundedInteger(env.FFMPEG_CLUSTER_CONCURRENCY, 2, 1, 16),
        clusterWaitMs: boundedInteger(env.FFMPEG_CLUSTER_WAIT_MS, 30 * 60 * 1000, 1_000, 2 * 60 * 60 * 1000)
    }
}

export function ffmpegClusterLimitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    if (DISABLED_VALUES.has(env.FFMPEG_CLUSTER_LIMIT_ENABLED?.trim().toLowerCase() ?? '')) return false
    if (env.VITEST && env.FFMPEG_CLUSTER_LIMIT_ENABLED !== '1') return false
    return Boolean(env.DATABASE_URL?.trim())
}
