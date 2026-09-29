'use client'

import { useId, useSyncExternalStore } from 'react'
import { Check, Palette } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { APP_THEMES, DEFAULT_APP_THEME, getAppThemeSnapshot, saveAppTheme, subscribeToAppTheme } from '@/lib/app-theme'

export default function GlobalThemeSettings() {
    const { t } = useI18n()
    const name = useId()
    const theme = useSyncExternalStore(subscribeToAppTheme, getAppThemeSnapshot, () => DEFAULT_APP_THEME)

    return (
        <fieldset className="min-w-0">
            <legend className="global-theme-title mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <Palette
                    aria-hidden="true"
                    className="h-4 w-4"
                />
                {t('主题设置')}
            </legend>
            <p className="sr-only">{t('选择主题色，将应用到所有页面。')}</p>
            <div className="grid grid-cols-2 gap-1.5">
                {APP_THEMES.map(item => (
                    <label
                        key={item.id}
                        className="global-theme-option flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-start transition">
                        <input
                            type="radio"
                            name={name}
                            value={item.id}
                            checked={item.id === theme}
                            onChange={() => saveAppTheme(item.id)}
                            className="sr-only"
                        />
                        <span
                            aria-hidden="true"
                            className="global-theme-swatch grid h-6 w-6 shrink-0 place-items-center rounded-full border"
                            style={{ background: `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})` }}>
                            {item.id === theme ? <Check className="h-4 w-4" /> : null}
                        </span>
                        <span className="min-w-0 break-words">
                            <strong className="global-theme-option-name block text-xs font-semibold leading-4">{t(item.name)}</strong>
                            <small className="global-theme-option-hint block text-[10px] leading-3.5">{t(item.hint)}</small>
                        </span>
                    </label>
                ))}
            </div>
        </fieldset>
    )
}
