import type { ReactNode } from 'react'
import type { Locale } from '@/i18n/config'
export default function SignupBonus({ children }: { locale: Locale; children?: ReactNode; compact?: boolean }) {
    return (
        <div className="rounded-3xl border border-violet-200/20 bg-[#151020] p-6 text-white">
            <p className="text-xl font-semibold">本地 AI 视频工作区</p>
            <p className="mt-2 text-sm text-slate-300">项目与素材保存在本机，使用自己的模型密钥开始创作。</p>
            {children}
        </div>
    )
}
