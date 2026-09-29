'use client'

import { useEffect } from 'react'
import { getAuthToken, onAuthChange } from '@/lib/auth'
import { logHiModelsDiagnosticEvent } from '@/lib/himodels-browser-diagnostics'
import type { HiModelsDiagnosticEvent } from '@/lib/himodels-response-diagnostics'

/** No UI and no paid requests: only authenticated, short-lived debug events. */
export default function HiModelsDiagnostics() {
    useEffect(() => {
        let cleanup = () => {}
        const connect = () => {
            cleanup()
            const token = getAuthToken()
            if (!token) return
            const since = Date.now()
            let cursor = ''
            let stopped = false
            let timer: ReturnType<typeof setTimeout> | undefined
            const controller = new AbortController()
            cleanup = () => {
                stopped = true
                clearTimeout(timer)
                controller.abort()
            }
            const poll = async () => {
                let delay = 1_500
                try {
                    const query = new URLSearchParams({ since: String(since), cursor })
                    const response = await fetch(`/api/diagnostics/himodels?${query}`, {
                        headers: { Authorization: `Bearer ${token}` },
                        cache: 'no-store',
                        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
                    })
                    if (stopped || getAuthToken() !== token) return
                    if (response.status === 401 || response.status === 404) return
                    if (!response.ok) throw new Error()
                    const data = (await response.json()) as { enabled: boolean; events: HiModelsDiagnosticEvent[]; cursor: string; hasMore: boolean }
                    if (stopped || getAuthToken() !== token || !data.enabled) return
                    for (const event of data.events) logHiModelsDiagnosticEvent(event)
                    cursor = data.cursor
                    if (data.hasMore) delay = 100
                } catch {
                    delay = 10_000 // Quiet backoff; never interrupt a generation.
                }
                if (!stopped) timer = setTimeout(poll, delay)
            }
            void poll()
        }
        connect()
        const unsubscribe = onAuthChange(connect)
        return () => {
            unsubscribe()
            cleanup()
        }
    }, [])
    return null
}
