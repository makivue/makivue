'use client'

import { ArrowRight, ChevronDown, Clapperboard, FilePenLine, Film, ImagePlus, UsersRound } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { faqCopy } from '@/i18n/faq'
import Link from '@/i18n/navigation'
import { CREATION_PRODUCTS } from '@/lib/creation-products'
import { CREATION_MODELS } from '@/lib/creation-model-overview'
import { seoPages } from '@/lib/seo-pages'
import styles from './HomeProductOverview.module.css'

const CREATION_STEPS = [
    {
        icon: FilePenLine,
        title: 'AI 编剧与故事创作',
        description: '从一句想法延展出故事大纲和分集剧本，也支持导入已有小说或剧本。按题材、集数和内容语言调整创作方向，让人物关系与剧情脉络逐步成形。'
    },
    {
        icon: UsersRound,
        title: '角色与场景设计',
        description: '选择写实、动漫、国风等视觉风格，生成角色设定和场景图片。在项目中管理并复用这些素材，为后续分镜提供统一的形象与环境参考。'
    },
    {
        icon: Clapperboard,
        title: 'AI 分镜与镜头生成',
        description: '将剧本拆解为包含画面、动作与对白的分镜，再生成分镜图片和视频。支持 Seedance 等视频模型，可逐镜预览和重新生成，调整画面与节奏。'
    },
    {
        icon: Film,
        title: '视频合成与作品发布',
        description: '按分镜顺序合成单集视频，完成字幕与成片检查。满意后导出视频，或发布到作品页，让观众按集观看你的故事。'
    }
] as const

const WORKFLOW = [
    {
        title: '写下故事，确定方向',
        description: '输入一句想法或粘贴小说、剧本片段，选择视觉风格、视频比例、集数与内容语言。开始创作时登录，创建属于这部作品的项目。'
    },
    {
        title: '完善剧本与角色场景',
        description: '在项目中检查故事大纲和分集内容，调整人物关系、剧情节奏与对白。生成角色参考图和场景图片，把文字中的世界变成可复用的视觉素材。'
    },
    {
        title: '确认分镜，再生成视频',
        description: '逐镜检查画面构图、动作和对白，先确认分镜图片与关键帧，再选择视频模型和时长。不满意的镜头可以单独调整，减少整集返工。'
    },
    {
        title: '检查成片，导出或发布',
        description: '按镜头顺序合成单集，检查声音、字幕和镜头衔接。下载成片用于后续剪辑，或完善作品信息并发布，让观众按集观看。'
    }
] as const

const USE_CASES = [
    {
        title: 'AI 漫剧与动画故事',
        description: '把幻想、冒险、童话或日常故事转化为动漫风格画面。通过角色设定、场景参考和分镜规划，逐步制作有连续剧情的动画短剧，探索不同画风的表达方式。'
    },
    {
        title: '写实短剧与人物故事',
        description: '从都市情感、悬疑冲突到古装剧情，以写实风格呈现人物、空间和动作。先打磨剧本与镜头节奏，再生成视频，适合需要对白和人物关系的故事创作。'
    },
    {
        title: '小说改编与个人创作',
        description: '将已有小说、剧本或自己的经历整理成分集故事。在一个项目中管理剧本、角色与镜头，按自己的节奏持续制作，也可以先完成一个片段验证想法。'
    },
    {
        title: '品牌故事与社交媒体内容',
        description: '围绕产品、主题或活动构思短片，选择合适的画幅和视觉风格。完整故事用短剧工作流制作，单张图片或短视频素材则可通过独立工具生成，再用于后续剪辑与发布。'
    }
] as const

const PRODUCT_ENTRIES = [
    { key: 'drama', icon: Clapperboard, href: '#drama-description', input: '一个故事想法、小说或分集剧本', output: '可继续编辑、合成与发布的系列剧集' },
    { key: 'video', icon: Film, href: '/aivideo', input: '文字描述、参考图片或关键帧', output: '可下载的视频片段' },
    { key: 'image', icon: ImagePlus, href: '/aiimage', input: '文字提示或参考图片', output: '角色、场景及其他视觉图片' }
] as const

const PROJECT_BENEFITS = [seoPages['ai-short-drama-generator'].benefits[0], ...seoPages['ai-video-generator'].benefits.slice(0, 2)]
const HOME_FAQ_QUESTIONS = new Set([
    '没有完整剧本也能开始吗？',
    '需要填写谁的模型密钥？',
    '界面和内容支持哪些语言？',
    '可以保持角色和场景的一致性吗？',
    '可以只重做一个镜头吗？',
    '支持对白、原声和字幕吗？',
    '模型调用如何收费？',
    'AI 视频生成需要等待多久？',
    '如何下载生成的图片或视频？',
    '作品可以用于商业项目吗？'
])
// Share answers with the help center so billing and capability copy stay aligned.
const SOURCE_FAQS = faqCopy('zh').categories.flatMap(category => category.items)

export default function HomeProductOverview() {
    const { locale, t } = useI18n()
    const homeFaqs = faqCopy(locale)
        .categories.flatMap(category => category.items)
        .filter((_, index) => HOME_FAQ_QUESTIONS.has(SOURCE_FAQS[index]?.question))

    return (
        <div data-home-auth-view="guest">
            <section
                className={styles.section}
                aria-labelledby="home-product-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-product-heading">{t('AI 短剧与漫剧，从故事到成片')}</h2>
                        <p>
                            {t(
                                'Local Drama Studio 将剧本、角色、场景、分镜与视频创作汇集到一个项目中。输入故事想法，或从已有小说、剧本继续创作，逐步制作写实短剧与动画漫剧；也可以使用 AI 图片和 AI 视频工具，单独生成创作素材。'
                            )}
                        </p>
                    </div>
                    <div className={styles.grid}>
                        {CREATION_STEPS.map(({ icon: Icon, title, description }, index) => (
                            <article
                                key={title}
                                className={styles.card}>
                                <div
                                    className={styles.cardTop}
                                    aria-hidden="true">
                                    <span className={styles.icon}>
                                        <Icon size={21} />
                                    </span>
                                    <span className={styles.step}>{String(index + 1).padStart(2, '0')}</span>
                                </div>
                                <h3>{t(title)}</h3>
                                <p>{t(description)}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
            <section
                className={`${styles.section} ${styles.sectionAlt}`}
                aria-labelledby="home-workflow-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-workflow-heading">{t('如何用 AI 制作短剧：从剧本到视频的四个阶段')}</h2>
                        <p>{t('AI 负责辅助生成，你决定故事的方向。每个阶段都可以先检查、再继续，已经确认的内容保存在项目中，方便随时回来完善。')}</p>
                    </div>
                    <ol className={styles.workflow}>
                        {WORKFLOW.map(({ title, description }, index) => (
                            <li key={title}>
                                <span
                                    className={styles.workflowNumber}
                                    aria-hidden="true">
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                <h3>{t(title)}</h3>
                                <p>{t(description)}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>
            <section
                className={styles.section}
                aria-labelledby="home-models-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-models-heading">{t('在 Local Drama Studio 使用 AI 模型，创作短剧、视频与图片')}</h2>
                        <p>
                            {t(
                                '在 Local Drama Studio，用 Seedance、Wan 或 MiniMax H3 生成视频，用 Nano Banana、Qwen-Image 或 Seedream 创作图片，再通过 Gemini 辅助剧本与分镜，把创意推进为可编辑的短剧作品。'
                            )}
                        </p>
                    </div>
                    <div className={styles.threeColumns}>
                        {CREATION_MODELS.map(({ id, actionModel, category, names, description, product }) => (
                            <article
                                key={id}
                                id={`home-model-${id}`}
                                className={`${styles.card} ${styles.modelCard}`}>
                                <span className={styles.modelCategory}>{t(category)}</span>
                                <h3>
                                    {names.map(name => (
                                        <span
                                            key={name}
                                            translate="no"
                                            data-i18n-skip>
                                            <bdi>{name}</bdi>
                                        </span>
                                    ))}
                                </h3>
                                <p>{t(description)}</p>
                                <Link
                                    href={product === 'drama' ? '/features/ai-storyboard-generator' : `/ai${product}`}
                                    className={styles.textLink}>
                                    {t('在 Local Drama Studio 使用 {model}', { model: actionModel })}
                                    <ArrowRight
                                        size={16}
                                        aria-hidden="true"
                                    />
                                </Link>
                            </article>
                        ))}
                    </div>
                    <aside className={styles.modelGuide}>
                        <h3>{t('如何选择适合当前镜头的 AI 模型？')}</h3>
                        <p>
                            {t(
                                '先确定需要文字生成、参考图引导还是带原声的视频，再比较画幅、时长、分辨率与预计模型费用。不同模型及版本的能力不同；例如 Seedance Global 当前提供文生视频，具体选项以创作页为准。建议先用一个镜头验证效果，再继续制作。'
                            )}
                        </p>
                    </aside>
                </div>
            </section>
            <section
                className={styles.section}
                aria-labelledby="home-use-cases-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-use-cases-heading">{t('AI 短剧与漫剧的创作场景')}</h2>
                        <p>{t('从写实短剧、动画漫剧到小说改编与品牌短片，先确定内容目标，再选择视觉风格和创作方式。你可以完成一部系列作品，也可以从一个镜头开始。')}</p>
                    </div>
                    <div className={styles.grid}>
                        {USE_CASES.map(({ title, description }) => (
                            <article
                                key={title}
                                className={styles.card}>
                                <h3>{t(title)}</h3>
                                <p>{t(description)}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
            <section
                className={`${styles.section} ${styles.sectionAlt}`}
                aria-labelledby="home-tools-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-tools-heading">{t('AI 短剧、AI 视频与 AI 图片生成工具')}</h2>
                        <p>{t('需要连续剧情和分集管理，选择 AI 短剧；只想生成一段视频或一张图片，可以直接进入对应工具。先浏览和填写内容，提交创作时再登录。')}</p>
                    </div>
                    <div className={styles.threeColumns}>
                        {PRODUCT_ENTRIES.map(({ key, icon: Icon, href, input, output }) => (
                            <article
                                key={key}
                                className={`${styles.card} ${styles.productCard}`}>
                                <span
                                    className={styles.icon}
                                    aria-hidden="true">
                                    <Icon size={21} />
                                </span>
                                <h3>{t(CREATION_PRODUCTS[key].title)}</h3>
                                <p>{t(CREATION_PRODUCTS[key].description)}</p>
                                <dl className={styles.productDetails}>
                                    <div>
                                        <dt>{t('创作起点')}</dt>
                                        <dd>{t(input)}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('最终产出')}</dt>
                                        <dd>{t(output)}</dd>
                                    </div>
                                </dl>
                                <Link
                                    href={href}
                                    className={styles.textLink}>
                                    {t(key === 'drama' ? 'AI 短剧' : key === 'video' ? 'AI 视频' : 'AI 图片')}
                                    <ArrowRight
                                        size={16}
                                        aria-hidden="true"
                                    />
                                </Link>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
            <section
                className={styles.section}
                aria-labelledby="home-benefits-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-benefits-heading">{t('为什么用 Local Drama Studio 制作 AI 短剧？')}</h2>
                        <p>{t('短剧制作需要不断确认和修改。Local Drama Studio 将故事、素材与生成进度留在项目里，让你能够分阶段推进，在质量、时间和预算之间做出选择。')}</p>
                    </div>
                    <div className={styles.threeColumns}>
                        {PROJECT_BENEFITS.map(({ title, description }) => (
                            <article
                                key={title}
                                className={styles.benefit}>
                                <h3>{t(title)}</h3>
                                <p>{t(description)}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
            <section
                className={`${styles.section} ${styles.sectionAlt}`}
                aria-labelledby="home-faq-heading">
                <div className={styles.container}>
                    <div className={styles.intro}>
                        <h2 id="home-faq-heading">{t('AI 短剧制作与视频生成常见问题')}</h2>
                        <p>{t('关于剧本、角色一致性、原声字幕、生成费用和作品导出的常见解答。')}</p>
                    </div>
                    <div className={styles.faqList}>
                        {homeFaqs.map(({ question, answer }) => (
                            <details
                                key={question}
                                name="home-creation-faq"
                                className={styles.faqItem}>
                                <summary>
                                    {question}
                                    <ChevronDown
                                        size={18}
                                        aria-hidden="true"
                                    />
                                </summary>
                                <p>{answer}</p>
                            </details>
                        ))}
                        <Link
                            href="/faq"
                            className={styles.textLink}>
                            {t('浏览全部问题')}
                            <ArrowRight
                                size={16}
                                aria-hidden="true"
                            />
                        </Link>
                    </div>
                </div>
            </section>
            <section
                className={`${styles.section} ${styles.cta}`}
                aria-labelledby="home-start-heading">
                <div className={styles.intro}>
                    <h2 id="home-start-heading">{t('从你的第一个故事开始')}</h2>
                    <p>{t('写下一句想法，选好风格，再逐步完成你的第一部短剧。使用自己的模型账号生成，项目和素材保存在本机。')}</p>
                    <a
                        href="#drama-description"
                        className={styles.primaryLink}>
                        {t('开始创作')}
                        <ArrowRight
                            size={18}
                            aria-hidden="true"
                        />
                    </a>
                </div>
            </section>
        </div>
    )
}
