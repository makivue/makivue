'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { usePwa } from '@/components/PwaProvider'
import { useI18n } from '@/i18n/I18nProvider'
import { pwaCopy } from '@/i18n/pwa'

export default function PwaInstall() {
    const pwa = usePwa()
    const { locale } = useI18n()
    const [failed, setFailed] = useState(false)
    const copy = pwaCopy[locale]
    if (!pwa || pwa.installed || (!pwa.canInstall && !pwa.isIOS && !failed)) return null

    return (
        <div className="global-preferences-divider mb-2.5 border-b pb-2.5">
            {pwa.canInstall ? (
                <button
                    type="button"
                    disabled={pwa.installing}
                    onClick={() => {
                        setFailed(false)
                        void pwa.install().catch(() => setFailed(true))
                    }}
                    className="global-theme-option global-theme-option-name flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-xs font-semibold transition disabled:opacity-60">
                    <Download
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0"
                    />
                    {pwa.installing ? copy.installing : copy.install}
                </button>
            ) : (
                <p className="global-theme-title text-xs font-semibold">{copy.install}</p>
            )}
            <p className="global-theme-option-hint mt-2 text-xs leading-5">{pwa.isIOS ? copy.ios : copy.description}</p>
            {failed && (
                <p
                    role="status"
                    className="global-theme-option-hint mt-2 text-xs leading-5">
                    {copy.failed}
                </p>
            )}
        </div>
    )
}
