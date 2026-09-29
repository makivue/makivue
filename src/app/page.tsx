'use client'

import { useSyncExternalStore } from 'react'
import { CircleHelp, FolderOpen, Gift } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { getAuthSessionSnapshot, HOME_AUTH_BOOTSTRAP_SCRIPT, onAuthChange } from '@/lib/auth'
import { getStylePreviewSrc } from '@/lib/style-preview'
import { SITE_NAME } from '@/lib/seo'
import BrandLogo from '@/components/BrandLogo'
import AuthBar from '@/components/AuthBar'
import { useSignIn } from '@/components/SignInProvider'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import WalletBalance from '@/components/WalletBalance'
import HomeWorksShowcase from '@/components/HomeWorksShowcase'
import StylePosterWall from '@/components/StylePosterWall'
import CreationModeNav from './create/CreationModeNav'
import DramaCreator from './create/drama/DramaCreator'
import { useCreationAuth } from './create/useCreationAuth'
import HeroStyleCarousel from './HeroStyleCarousel'
import HomeProductOverview from './HomeProductOverview'
import styles from './HomeStudio.module.css'
const STYLE_SHOWCASE_ROWS = [
    [
        { key: 'cn-3d', label: '国漫 3D' },
        { key: 'anime', label: '日系动漫' },
        { key: 'q-version', label: 'Q版可爱' },
        { key: 'graphic-novel', label: '漫画分镜' },
        { key: 'modern-drama', label: '现代短剧写实' },
        { key: 'cinematic', label: '电影写实' },
        { key: 'xianxia', label: '古装仙侠' },
        { key: 'cyberpunk', label: '赛博霓虹' },
        { key: 'vampire-gothic', label: '吸血鬼哥特' },
        { key: 'werewolf-alpha', label: '狼人阿尔法' },
        { key: 'american-highschool', label: '美式青春校园' },
        { key: 'hollywood-blockbuster', label: '好莱坞大片' },
        { key: 'hiphop-street', label: '嘻哈街头' },
        { key: 'afrofuturism', label: '非洲未来主义' },
        { key: 'nollywood-glam', label: '尼日利亚豪门' },
        { key: 'african-tribal-fantasy', label: '非洲部落奇幻' },
        { key: 'european-royal', label: '欧洲皇室' },
        { key: 'nordic-noir', label: '北欧冷冽悬疑' },
        { key: 'french-romance', label: '法式浪漫' },
        { key: 'british-period', label: '英伦古典' }
    ],
    [
        { key: 'new-chinese-3d', label: '新中式国漫' },
        { key: 'anime-film', label: '动画电影感' },
        { key: 'claymation', label: '粘土定格' },
        { key: 'oil-painting', label: '油画艺术' },
        { key: 'korean-clean', label: '韩剧清透感' },
        { key: 'hk-film', label: '港风胶片' },
        { key: 'chinese-ink', label: '中国水墨' },
        { key: 'dark-fantasy', label: '暗黑奇幻' },
        { key: 'post-apocalyptic', label: '废土末世' },
        { key: 'arabian-nights', label: '一千零一夜' },
        { key: 'middle-east-modern', label: '中东现代豪门' },
        { key: 'desert-tribal', label: '沙漠部落' },
        { key: 'bollywood', label: '宝莱坞歌舞' },
        { key: 'indian-mythology', label: '印度神话' },
        { key: 'telenovela', label: '拉丁狗血剧' },
        { key: 'latin-carnival', label: '拉美狂欢节' },
        { key: 'thai-supernatural', label: '泰式恐怖悬疑' },
        { key: 'southeast-asia-street', label: '东南亚街头' },
        { key: 'aussie-outback', label: '澳洲内陆' }
    ]
].map(row =>
    row.map(style => ({
        ...style,
        src: getStylePreviewSrc(style.key),
        thumbnailSrc: getStylePreviewSrc(style.key, 384),
        thumbnailSrcSet: `${getStylePreviewSrc(style.key, 256)} 256w, ${getStylePreviewSrc(style.key, 384)} 384w`
    }))
)

export default function LandingPage() {
    const { t } = useI18n()
    const requestSignIn = useSignIn()
    const { userId } = useCreationAuth()
    const authSnapshot = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    return (
        <div
            data-home-auth={userId ? 'member' : 'guest'}
            suppressHydrationWarning
            className={`home-theme ${styles.page}`}>
            {!authSnapshot && (
                <script
                    data-i18n-skip
                    dangerouslySetInnerHTML={{ __html: HOME_AUTH_BOOTSTRAP_SCRIPT }}
                />
            )}
            <SiteHeader
                sticky
                className={styles.header}
                contentClassName={styles.headerContent}>
                <Link
                    href="/"
                    aria-label={SITE_NAME}
                    className={styles.brand}>
                    <BrandLogo />
                    <span translate="no">{SITE_NAME}</span>
                </Link>
                <CreationModeNav mode="drama" />
                <div className={styles.account}>
                    {userId && (
                        <Link
                            href="/projects"
                            className={styles.projectLink}
                            aria-label={t('我的项目')}>
                            <FolderOpen size={16} />
                            <span>{t('我的项目')}</span>
                        </Link>
                    )}
                    <Link
                        href="/faq"
                        className={styles.faqLink}
                        aria-label={t('常见问题')}>
                        <CircleHelp size={17} />
                    </Link>
                    {userId && (
                        <WalletBalance
                            key={userId}
                            userId={userId}
                            compact
                        />
                    )}
                    <div className="hidden sm:block">
                        <AuthBar />
                    </div>
                    <div className="sm:hidden [&_[role=menu]]:end-0 [&_[role=menu]]:start-auto">
                        <AuthBar variant="compact" />
                    </div>
                </div>
            </SiteHeader>
            <main>
                <section
                    className={styles.hero}
                    aria-labelledby="home-heading">
                    <HeroStyleCarousel />
                    <div className={styles.heroContent}>
                        <h1 id="home-heading">
                            {t('AI 短剧生成器')}
                            <span>{t('让创意成为短剧')}</span>
                        </h1>
                        <p className={styles.subtitle}>{t('输入创意、小说或剧本，逐步完成角色设计、分镜与视频制作，创作你的短剧和漫剧。')}</p>
                        <DramaCreator />
                        <button
                            type="button"
                            aria-haspopup="dialog"
                            onClick={() => {
                                void requestSignIn()
                            }}
                            data-home-auth-view="guest"
                            className={styles.offer}>
                            <Gift size={14} />
                            {t('素材本地保存 · 模型直连')}
                        </button>
                    </div>
                </section>
                <HomeWorksShowcase />
                <StylePosterWall rows={STYLE_SHOWCASE_ROWS} />
                <HomeProductOverview />
            </main>
            <SiteFooter />
        </div>
    )
}
