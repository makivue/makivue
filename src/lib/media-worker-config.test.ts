import { describe, expect, it } from 'vitest'
import { durableMediaWorkerEnabled, ffmpegClusterLimitEnabled, ffmpegRuntimeConfig, projectImportWorkerEnabled } from './media-worker-config'

describe('media worker runtime configuration', () => {
    it('keeps the worker backward compatible unless a Web deployment disables it', () => {
        expect(durableMediaWorkerEnabled({})).toBe(true)
        expect(durableMediaWorkerEnabled({ ENABLE_DURABLE_MEDIA_WORKER: '0' })).toBe(false)
        expect(durableMediaWorkerEnabled({ ENABLE_DURABLE_MEDIA_WORKER: 'false' })).toBe(false)
        expect(durableMediaWorkerEnabled({ ENABLE_DURABLE_MEDIA_WORKER: '1' })).toBe(true)
        expect(projectImportWorkerEnabled({ ENABLE_PROJECT_IMPORT_WORKER: '0' })).toBe(false)
        expect(projectImportWorkerEnabled({})).toBe(true)
    })

    it('uses CPU-safe FFmpeg defaults and bounds deployment overrides', () => {
        expect(ffmpegRuntimeConfig({})).toMatchObject({ concurrency: 1, threads: 2, preset: 'fast', clusterConcurrency: 2 })
        expect(
            ffmpegRuntimeConfig({
                FFMPEG_CONCURRENCY: '99',
                FFMPEG_THREADS: '0',
                FFMPEG_PRESET: 'invalid',
                FFMPEG_CLUSTER_CONCURRENCY: '4'
            })
        ).toMatchObject({ concurrency: 4, threads: 1, preset: 'fast', clusterConcurrency: 4 })
    })

    it('enables the shared limit only when a database is available', () => {
        expect(ffmpegClusterLimitEnabled({ DATABASE_URL: 'mysql://database' })).toBe(true)
        expect(ffmpegClusterLimitEnabled({ DATABASE_URL: 'mysql://database', FFMPEG_CLUSTER_LIMIT_ENABLED: '0' })).toBe(false)
        expect(ffmpegClusterLimitEnabled({ DATABASE_URL: 'mysql://database', VITEST: 'true' })).toBe(false)
        expect(ffmpegClusterLimitEnabled({ DATABASE_URL: 'mysql://database', VITEST: 'true', FFMPEG_CLUSTER_LIMIT_ENABLED: '1' })).toBe(true)
    })
})
