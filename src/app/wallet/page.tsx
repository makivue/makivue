import Link from '@/i18n/navigation'
import HomeLogoLink from '@/components/HomeLogoLink'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
export default function WalletPage() {
    return (
        <>
            <SiteHeader>
                <HomeLogoLink />
            </SiteHeader>
            <main className="mx-auto max-w-2xl px-6 py-20 text-white">
                <h1 className="text-2xl font-semibold">本地工作区</h1>
                <p className="mt-4 text-slate-300">本地版不使用金币或充值。模型费用由你配置的供应商账户结算。</p>
                <Link
                    href="/settings"
                    className="mt-6 inline-block text-violet-300">
                    查看模型设置
                </Link>
            </main>
            <SiteFooter />
        </>
    )
}
