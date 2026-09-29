import { currentUserId } from '@/lib/current-user'
import { hiModelsDiagnosticStore } from '@/lib/himodels-diagnostic-store.server'
import { hiModelsResponseDiagnosticsEnabled } from '@/lib/himodels-response-diagnostics'

export const runtime = 'nodejs'

export async function GET(req: Request) {
    const userId = currentUserId(req)
    const headers = { 'Cache-Control': 'private, no-store' }
    if (userId === null) return Response.json({ error: 'login required' }, { status: 401, headers })
    if (!hiModelsResponseDiagnosticsEnabled()) return Response.json({ enabled: false, events: [] }, { headers })
    const url = new URL(req.url)
    const since = Number(url.searchParams.get('since'))
    if (!Number.isFinite(since) || since <= 0) return Response.json({ error: 'since required' }, { status: 400, headers })
    return Response.json({ enabled: true, ...hiModelsDiagnosticStore.read(userId.toString(), url.searchParams.get('cursor'), since) }, { headers })
}
