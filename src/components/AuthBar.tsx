'use client'
import { FolderLock, UserRound } from 'lucide-react'
import Link from '@/i18n/navigation'
export default function AuthBar({ variant = 'default' }: { variant?: 'default' | 'compact' }) {
    return (
        <div className={`flex items-center ${variant === 'compact' ? 'gap-1' : 'gap-3'}`}>
            <Link
                href="/settings"
                className={`inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 text-sm text-gray-200 ${variant === 'compact' ? 'h-8 w-8' : 'px-3 py-2'}`}
                aria-label="本地工作区"
                title="本地工作区">
                <FolderLock size={16} />
                {variant === 'default' && '本地工作区'}
            </Link>
            <Link
                href="/profile"
                title="个人中心"
                aria-label="个人中心"
                className={variant === 'compact' ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-300' : 'text-sm text-gray-300'}>
                {variant === 'compact' ? <UserRound size={16} aria-hidden="true" /> : '个人中心'}
            </Link>
        </div>
    )
}
