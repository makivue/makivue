import { describe, expect, it } from 'vitest'
import { createHiModelsDiagnosticStore } from './himodels-diagnostic-store.server'
import type { HiModelsDiagnosticEvent } from './himodels-response-diagnostics'

const event = (id: string): HiModelsDiagnosticEvent => ({ id, phase: 'request', model: 'model', method: 'POST', url: '/endpoint', timestamp: '', body: { text: 'hello' }, truncated: false })

describe('bounded HiModels browser feed', () => {
    it('uses cursors, never leaks other users, and excludes history from before page load', () => {
        const store = createHiModelsDiagnosticStore()
        store.append('1', event('old'), 1)
        store.append('1', event('new'), 20)
        store.append('2', event('other'), 20)
        const first = store.read('1', null, 10, 20)
        expect(first.events.map(item => item.id)).toEqual(['new'])
        expect(store.read('1', first.cursor, 10, 21).events).toEqual([])
        store.append('1', event('later'), 22)
        expect(store.read('1', first.cursor, 10, 22).events.map(item => item.id)).toEqual(['later'])
    })

    it('expires old events and bounds memory per user', () => {
        const store = createHiModelsDiagnosticStore(1000, 400)
        for (let i = 0; i < 8; i++) store.append('1', event(String(i)), 100 + i)
        const page = store.read('1', null, 0, 108)
        expect(page.events.length).toBeLessThan(8)
        expect(page.events.at(-1)?.id).toBe('7')
        expect(store.read('1', null, 0, 1_000_000).events).toEqual([])
    })
})
