'use client'
import { FolderLock } from 'lucide-react'
import Link from '@/i18n/navigation'
export default function AuthBar({ variant = 'default' }: { variant?: 'default' | 'compact' }) {
    return (
        <div className="flex items-center gap-3">
            <Link
                href="/settings"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200"
                title="本地工作区">
                <FolderLock size={16} />
                {variant === 'default' && '本地工作区'}
            </Link>
            <Link
                href="/profile"
                className="text-sm text-gray-300">
                个人中心
            </Link>
        </div>
    )
}
