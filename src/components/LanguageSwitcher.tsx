'use client'

import { useId } from 'react'
import { Check, Languages } from 'lucide-react'

import { localeDisplayName, locales, type Locale } from '@/i18n/config'
import { useI18n } from '@/i18n/I18nProvider'

export default function LanguageSwitcher({ onChoose }: { onChoose: () => void }) {
    const { locale, setLocale, t } = useI18n()
    const name = useId()
    const choose = (next: Locale) => {
        onChoose()
        setLocale(next)
    }

    return (
        <fieldset className="min-w-0">
            <legend className="global-theme-title mb-2 flex min-h-7 items-center gap-1.5 pe-9 text-xs font-semibold">
                <Languages
                    aria-hidden="true"
                    className="h-4 w-4"
                />
                {t('选择语言')}
            </legend>
            <p className="sr-only">{t('页面将切换到所选语言')}</p>
            <div className="grid grid-cols-2 gap-1">
                {locales.map(item => (
                    <label
                        key={item}
                        className="global-preferences-language flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition">
                        <input
                            type="radio"
                            name={name}
                            value={item}
                            checked={item === locale}
                            onChange={() => choose(item)}
                            className="sr-only"
                        />
                        <span
                            aria-hidden="true"
                            dir="ltr"
                            className="global-theme-description w-5 shrink-0 text-[10px] font-semibold uppercase">
                            {item}
                        </span>
                        <span className="min-w-0 flex-1 break-words">{localeDisplayName(locale, item)}</span>
                        {item === locale ? (
                            <Check
                                aria-hidden="true"
                                className="h-3.5 w-3.5 shrink-0"
                            />
                        ) : null}
                    </label>
                ))}
            </div>
        </fieldset>
    )
}
