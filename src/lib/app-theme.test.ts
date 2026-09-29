import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_THEMES, APP_THEME_BOOTSTRAP_SCRIPT, DEFAULT_APP_THEME, getAppThemeSnapshot, saveAppTheme, subscribeToAppTheme } from './app-theme'
import { locales } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'

afterEach(() => vi.unstubAllGlobals())

function browserState(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial))
    const dataset: Record<string, string> = {}
    const events = new EventTarget()
    const localStorage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
    }
    const document = { documentElement: { dataset } }
    vi.stubGlobal('window', {
        localStorage,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events)
    })
    vi.stubGlobal('document', document)
    return { localStorage, document, dataset }
}

describe('global appearance regression', () => {
    it('defaults to Aurora blue on the server and preserves legacy preferences', () => {
        expect(DEFAULT_APP_THEME).toBe('aurora')
        expect(getAppThemeSnapshot()).toBe('aurora')
        browserState({ 'local-studio-home-theme': 'cobalt' })
        expect(getAppThemeSnapshot()).toBe('cobalt')
    })

    it.each([
        {},
        { 'local-studio-app-theme': 'unknown' },
        { 'local-studio-app-theme': 'unknown', 'local-studio-home-theme': 'unknown' },
        { 'local-studio-app-theme': 'carbon' },
        { 'local-studio-home-theme': 'carbon' },
        { 'local-studio-app-theme': 'carbon', 'local-studio-home-theme': 'cobalt' }
    ])('uses Aurora blue when preferences are missing, invalid, or retired: %j', initial => {
        const context = browserState(initial)
        expect(getAppThemeSnapshot()).toBe('aurora')
        runInNewContext(APP_THEME_BOOTSTRAP_SCRIPT, context)
        expect(context.dataset).toEqual({ appTheme: 'aurora', homeTheme: 'aurora', appTone: 'dark' })
        expect(context.localStorage.getItem('local-studio-app-theme')).toBe('aurora')
        expect(getAppThemeSnapshot()).toBe('aurora')
    })

    it('uses Aurora blue when browser storage is unavailable', () => {
        const context = browserState()
        vi.spyOn(context.localStorage, 'getItem').mockImplementation(() => {
            throw new Error('Storage unavailable')
        })
        runInNewContext(APP_THEME_BOOTSTRAP_SCRIPT, context)
        expect(context.dataset).toEqual({ appTheme: 'aurora', homeTheme: 'aurora', appTone: 'dark' })
        expect(getAppThemeSnapshot()).toBe('aurora')
    })

    it.each(APP_THEMES)('keeps the initial script and runtime in sync for $id', theme => {
        const context = browserState({ 'local-studio-app-theme': theme.id, 'local-studio-home-theme': 'carbon' })
        runInNewContext(APP_THEME_BOOTSTRAP_SCRIPT, context)
        expect(context.dataset).toEqual({ appTheme: theme.id, homeTheme: theme.id, appTone: theme.tone })
        expect(getAppThemeSnapshot()).toBe(theme.id)
    })

    it('notifies subscribers and removes listeners on unmount', () => {
        const { dataset } = browserState()
        const listener = vi.fn()
        const unsubscribe = subscribeToAppTheme(listener)
        saveAppTheme('cobalt')
        expect(getAppThemeSnapshot()).toBe('cobalt')
        expect(dataset.appTone).toBe('light')
        expect(listener).toHaveBeenCalledOnce()
        unsubscribe()
        saveAppTheme('classic')
        expect(listener).toHaveBeenCalledOnce()
    })

    it.each(locales.filter(locale => locale !== 'zh'))('translates every theme name and hint in %s', locale => {
        for (const theme of APP_THEMES) {
            expect(translateMessage(locale, theme.name)).not.toBe(theme.name)
            expect(translateMessage(locale, theme.hint)).not.toBe(theme.hint)
        }
    })
})
