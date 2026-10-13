import { getAuthToken, onAuthChange } from './auth'
import { logHiModelsDiagnosticEvent } from './himodels-browser-diagnostics'
import type { HiModelsDiagnosticEvent } from './himodels-response-diagnostics'
import { BROWSER_API_ERROR_EVENT } from './browser-error-diagnostics'

/** Errors are automatic; sessionStorage opt-in adds raw request/response diagnostics. */
export function startHiModelsDiagnostics() {
    if (typeof window === 'undefined') return () => {}
    let rawDiagnostics = false
    try {
        rawDiagnostics = window.sessionStorage.getItem('himodels-diagnostics') === 'true'
    } catch {}

    let cleanup = () => {}
    let activeToken: string | null = null
    const connect = () => {
        const token = getAuthToken()
        if (token === activeToken) return
        cleanup()
        activeToken = token
        if (!token) return
        const since = Date.now()
        let cursor = ''
        let stopped = false
        let terminal = false
        let idleDelay = 5_000
        let errorDelay = 10_000
        let timer: ReturnType<typeof setTimeout> | undefined
        let requestController: AbortController | undefined
        const poll = async () => {
            if (stopped || terminal || document.hidden || requestController) return
            const controller = new AbortController()
            requestController = controller
            let delay: number
            try {
                const query = new URLSearchParams({ since: String(since), cursor })
                if (!rawDiagnostics) query.set('errorsOnly', '1')
                const response = await fetch(`/api/diagnostics/himodels?${query}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
                })
                if (stopped || controller.signal.aborted || getAuthToken() !== token) return
                if (response.status === 401 || response.status === 403 || response.status === 404) {
                    terminal = true
                    return
                }
                if (!response.ok) throw new Error()
                const data = (await response.json()) as { enabled: boolean; events: HiModelsDiagnosticEvent[]; cursor: string; hasMore: boolean }
                if (stopped || controller.signal.aborted || getAuthToken() !== token) return
                if (!data.enabled) {
                    terminal = true
                    return
                }
                for (const event of data.events) logHiModelsDiagnosticEvent(event)
                cursor = data.cursor
                errorDelay = 10_000
                idleDelay = data.events.length || data.hasMore ? 5_000 : Math.min(idleDelay * 2, 60_000)
                delay = data.hasMore ? 1_000 : idleDelay
            } catch {
                if (stopped || controller.signal.aborted) return
                delay = errorDelay
                errorDelay = Math.min(errorDelay * 2, 60_000)
            } finally {
                if (requestController === controller) requestController = undefined
            }
            if (!stopped && !document.hidden) timer = setTimeout(poll, delay)
        }
        const onVisibilityChange = () => {
            clearTimeout(timer)
            requestController?.abort()
            requestController = undefined
            if (!document.hidden) void poll()
        }
        const onApiError = () => {
            if (stopped || terminal || document.hidden || requestController) return
            clearTimeout(timer)
            timer = setTimeout(poll, 1_000)
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener(BROWSER_API_ERROR_EVENT, onApiError)
        cleanup = () => {
            stopped = true
            clearTimeout(timer)
            requestController?.abort()
            document.removeEventListener('visibilitychange', onVisibilityChange)
            window.removeEventListener(BROWSER_API_ERROR_EVENT, onApiError)
        }
        void poll()
    }
    connect()
    const unsubscribe = onAuthChange(connect)
    return () => {
        unsubscribe()
        cleanup()
    }
}
