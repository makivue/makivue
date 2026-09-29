import type { ReactNode } from 'react'
import GlobalPreferences from '@/components/GlobalPreferences'

export default function SiteHeader({ children, sticky = false, className = '', contentClassName = '' }: { children: ReactNode; sticky?: boolean; className?: string; contentClassName?: string }) {
    return (
        <header className={`site-header ${sticky ? 'sticky top-0' : 'relative'} w-full print:hidden ${className}`.trim()}>
            <div className="site-header-shell flex items-start gap-2 sm:gap-3 xl:items-center">
                <div className={`site-header-inner min-w-0 flex-1 ${contentClassName}`.trim()}>{children}</div>
                <GlobalPreferences />
            </div>
        </header>
    )
}
