import { renderMediaWorkerPrometheusMetrics } from '@/lib/media-worker-metrics'

export async function GET() {
    try {
        return new Response(await renderMediaWorkerPrometheusMetrics(), {
            headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
            }
        })
    } catch (error) {
        console.error('[media-metrics] collection failed', error)
        return new Response('# media worker metrics unavailable\n', {
            status: 503,
            headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
            }
        })
    }
}
