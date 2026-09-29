export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SKIP_LOCAL_WORKERS === '1' || process.env.NEXT_PHASE === 'phase-production-build') return
    const { startDurableMediaWorker } = await import('./src/services/durable-media-worker')
    const { startProjectImportWorker } = await import('./src/services/project-import-worker')
    startDurableMediaWorker()
    startProjectImportWorker()
}
