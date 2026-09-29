import { VISUAL_STYLE_PRESETS, type VisualStylePreset } from '@/lib/novel'
import { DEFAULT_PROJECT_GENRE } from '@/lib/project-genres'
import { REGIONAL_STORY_GROUPS, REGIONAL_STORY_PRESETS } from '@/lib/regional-story-presets'
import type { Locale } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'

// 完整旧分类仅用于把历史/AI 推荐的细分风格归并到创建页代表风格；
// 不直接展示，避免用户在上百个近似预设中选择。
const LEGACY_STYLE_GROUPS = [
    {
        key: 'africa',
        label: '非洲影视',
        styles: [
            'nollywood-glam',
            'african-tribal-fantasy',
            'afrofuturism',
            'west-african-folklore',
            'east-african-pastoral',
            'ethiopian-highland',
            'saharan-tuareg',
            'great-rift-valley',
            'serengeti-migration',
            'okavango-delta',
            'kalahari-desert',
            'congo-basin',
            'madagascar-wildlife',
            'african-river-kingdom',
            'baobab-savanna'
        ]
    },
    {
        key: 'middle-east-india',
        label: '阿拉伯中东',
        styles: ['arabian-nights', 'arabian-bedouin', 'persian-folklore', 'levantine-old-city', 'ottoman-period', 'middle-east-modern', 'desert-tribal', 'bollywood', 'indian-mythology']
    },
    {
        key: 'southeast-asia-oceania',
        label: '东南亚澳洲',
        styles: [
            'thai-supernatural',
            'southeast-asia-street',
            'malay-folklore',
            'indonesian-folklore',
            'philippine-folklore',
            'vietnamese-folklore',
            'khmer-mythology',
            'pacific-island-folklore',
            'aussie-outback'
        ]
    },
    {
        key: 'fairytale',
        label: '童话寓言',
        styles: [
            'fairytale-book',
            'enchanted-forest',
            'dark-fairytale',
            'princess-fairytale',
            'animal-fable',
            'ocean-fairytale',
            'nordic-fairytale',
            'candyland-fairytale',
            'clockwork-fairytale',
            'chinese-fairy-tale',
            'pop-up-book',
            'paper-theater'
        ]
    },
    {
        key: 'war',
        label: '战争史诗',
        styles: ['modern-war', 'ww2-war', 'ancient-battlefield', 'desert-war', 'naval-war', 'resistance-war', 'trench-war', 'aerial-war', 'samurai-war', 'dieselpunk', 'action-thriller']
    },
    {
        key: 'adventure',
        label: '冒险探索',
        styles: [
            'jungle-expedition',
            'lost-world-adventure',
            'treasure-hunt',
            'archaeological-adventure',
            'ocean-voyage',
            'polar-expedition',
            'desert-expedition',
            'mountain-climbing',
            'river-rafting',
            'castaway-diary',
            'raft-drift',
            'shipwreck-adventure',
            'cave-expedition',
            'canyon-adventure',
            'island-treasure',
            'jungle-river-adventure',
            'hot-air-balloon-adventure',
            'underground-world',
            'pirate-adventure',
            'deep-sea-expedition',
            'sky-island-adventure',
            'volcano-expedition',
            'time-expedition',
            'micro-world-adventure',
            'robot-companion-adventure',
            'family-road-adventure',
            'train-cross-continent',
            'ancient-sea-route'
        ]
    },
    {
        key: 'survival',
        label: '极境生存',
        styles: ['wilderness-survival', 'island-survival', 'jungle-survival', 'arctic-survival', 'desert-survival', 'ocean-survival', 'disaster-survival', 'primitive-survival']
    },
    {
        key: 'animal-world',
        label: '动物世界',
        styles: [
            'african-wildlife',
            'savanna-wildlife-doc',
            'savanna-animal-kingdom',
            'rainforest-wildlife',
            'ocean-wildlife',
            'arctic-wildlife',
            'prehistoric-animals',
            'insect-micro-world',
            'bird-migration',
            'animal-family-doc',
            'nostalgic-chinese-animal-cartoon',
            'animal-city-comedy',
            'forest-animal-adventure',
            'ocean-animal-animation',
            'dinosaur-family-animation',
            'pet-adventure',
            'horse-epic',
            'wolf-pack',
            'big-cat-kingdom',
            'primate-tribe'
        ]
    },
    {
        key: 'cosmos',
        label: '宇宙星空',
        styles: ['deep-space-nebula', 'milky-way-stargazing', 'black-hole-voyage', 'exoplanet-landscape', 'solar-system-epic', 'cosmic-birth', 'astronaut-loneliness', 'celestial-fantasy']
    },
    {
        key: 'human-origin',
        label: '人类起源',
        styles: ['human-origins', 'stone-age-tribe', 'neolithic-village', 'cave-art-era', 'ancient-migration', 'first-civilization', 'bronze-age-epic', 'evolutionary-journey']
    },
    {
        key: 'disaster',
        label: '灾难奇观',
        styles: ['volcanic-eruption', 'mega-earthquake', 'tsunami-disaster', 'superstorm', 'wildfire-disaster', 'ice-age-cataclysm', 'asteroid-impact', 'global-flood']
    },
    {
        key: 'folk-region',
        label: '民族地域',
        styles: [
            'japanese-festival',
            'korean-folklore',
            'chinese-ethnic-miao',
            'tibetan-folklore',
            'mongolian-steppe',
            'central-asian-silk-road',
            'mexican-day-dead',
            'andean-folklore',
            'celtic-folklore',
            'maori-legend',
            'arctic-indigenous',
            'slavic-folklore',
            'latin-carnival',
            'telenovela',
            'european-royal',
            'nordic-noir',
            'french-romance',
            'british-period'
        ]
    },
    {
        key: 'three-d',
        label: '3D动画',
        styles: ['cn-3d', 'new-chinese-3d', 'western-3d', 'toon-shaded-3d', 'fantasy-3d', 'isometric-3d', 'game-cg-3d', 'hyperreal-3d', 'low-poly-art', 'voxel-3d', 'ceramic-3d', 'holographic-3d']
    },
    {
        key: 'anime',
        label: '动漫风格',
        styles: [
            'anime',
            'shoujo-manga',
            'shonen-action',
            'webtoon',
            'anime-film',
            'retro-anime',
            'lyrical-sky-anime',
            'noir-anime',
            'mecha-anime',
            'fantasy-anime',
            'sports-anime',
            'magical-heroine-anime'
        ]
    },
    {
        key: 'cute',
        label: '可爱Q版',
        styles: ['q-version', 'claymation', 'paper-cutout', 'fairytale-book', 'plush-toy', 'miniature-diorama', 'felt-craft', 'sticker-art', 'toy-brick', 'kawaii-3d', 'pop-up-book', 'paper-theater']
    },
    {
        key: 'illustration',
        label: '插画艺术',
        styles: [
            'graphic-novel',
            'oil-painting',
            'watercolor',
            'thick-painting',
            'editorial-illustration',
            'pastel-pencil',
            'linocut-print',
            'risograph',
            'art-nouveau',
            'charcoal-sketch',
            'stained-glass',
            'ukiyo-e-print'
        ]
    },
    {
        key: 'romance',
        label: '都市言情',
        styles: [
            'modern-drama',
            'korean-clean',
            'thai-saturated',
            'urban-neon-real',
            'luxury-romance',
            'soft-idol-drama',
            'campus-romance',
            'office-romance',
            'rainy-neon-romance',
            'vintage-romance',
            'summer-romance',
            'healing-romance'
        ]
    },
    {
        key: 'realistic',
        label: '写实风格',
        styles: ['cinematic', 'hk-film', 'hk-crime', 'minguo', 'docu-realism', 'suspense-noir', 'action-thriller', 'legal-drama', 'medical-drama', 'family-ethics', 'business-war', 'social-realism']
    },
    {
        key: 'costume',
        label: '古风玄幻',
        styles: [
            'xianxia',
            'chinese-ink',
            'wuxia-ink',
            'palace-drama',
            'mythic-fantasy',
            'dunhuang-fantasy',
            'tang-dynasty',
            'song-dynasty',
            'wuxia-realism',
            'ghost-romance',
            'snow-jianghu',
            'lotus-fantasy'
        ]
    },
    {
        key: 'genre',
        label: '科幻奇幻',
        styles: [
            'cyberpunk',
            'alien-contact',
            'hard-sci-fi',
            'planetary-colony',
            'robot-society',
            'retro-futurism',
            'cosmic-horror',
            'neon-space-western',
            'utopian-sci-fi',
            'interstellar-ark',
            'dark-fantasy',
            'post-apocalyptic',
            'space-opera',
            'steampunk',
            'monster-fantasy',
            'solarpunk',
            'biopunk',
            'time-travel',
            'underwater-fantasy',
            'dreamcore-fantasy',
            'dieselpunk'
        ]
    },
    {
        key: 'western',
        label: '欧美影视',
        styles: [
            'vampire-gothic',
            'werewolf-alpha',
            'post-apocalyptic',
            'american-highschool',
            'hollywood-blockbuster',
            'hiphop-street',
            'european-royal',
            'nordic-noir',
            'french-romance',
            'british-period'
        ]
    },
    {
        key: 'latin-america',
        label: '拉美影视',
        styles: ['telenovela', 'latin-carnival']
    },
    {
        key: 'regional-more',
        label: '更多地域',
        styles: ['hiphop-street', 'american-highschool', 'hollywood-blockbuster', 'vampire-gothic', 'werewolf-alpha']
    }
] as const

const STYLE_CLUSTER_DEFINITIONS = [
    { key: 'live-action', label: '影视写实', hint: '都市、情感、悬疑、欧美与商业短剧', legacyGroups: ['romance', 'realistic', 'western', 'latin-america'] },
    { key: 'costume-history', label: '古装历史', hint: '仙侠、武侠、宫廷与年代题材', legacyGroups: ['costume'] },
    { key: 'anime-comic', label: '动漫插画', hint: '日漫、条漫、漫画与平面艺术', legacyGroups: ['anime', 'illustration'] },
    { key: 'three-d-cute', label: '3D / Q版', hint: '三维动画、黏土、玩偶与可爱风', legacyGroups: ['three-d', 'cute'] },
    { key: 'sci-fi-fantasy', label: '科幻奇幻', hint: '未来科技、童话、魔幻与太空', legacyGroups: ['genre', 'cosmos', 'fairytale'] },
    { key: 'nature-documentary', label: '自然纪实', hint: '动物世界、自然、人类起源纪录片', legacyGroups: ['animal-world', 'human-origin'] },
    { key: 'adventure-disaster', label: '冒险灾难', hint: '探索、生存、战争与灾难奇观', legacyGroups: ['war', 'adventure', 'survival', 'disaster'] },
    {
        key: 'regional-folklore',
        label: '地域民俗',
        hint: '非洲、中东、南亚、东南亚与世界民族文化',
        legacyGroups: ['africa', 'middle-east-india', 'southeast-asia-oceania', 'folk-region', 'regional-more']
    }
] as const

export function localizeStyleCluster(locale: Locale, cluster: { key: string; label: string; hint: string }) {
    return { label: translateMessage(locale, cluster.label), hint: translateMessage(locale, cluster.hint) }
}

export const STYLE_GROUPS = (() => {
    const assigned: Set<string> = new Set()
    const groups: { key: string; label: string; hint: string; styles: string[] }[] = STYLE_CLUSTER_DEFINITIONS.map(cluster => {
        const styles: string[] = cluster.legacyGroups
            .flatMap(groupKey => LEGACY_STYLE_GROUPS.find(group => group.key === groupKey)?.styles ?? [])
            .filter(styleKey => !assigned.has(styleKey) && assigned.add(styleKey))
        return { ...cluster, styles }
    })
    for (const region of REGIONAL_STORY_GROUPS) {
        const styles = REGIONAL_STORY_PRESETS.filter(preset => preset.region === region.key).map(preset => preset.key)
        styles.forEach(key => assigned.add(key))
        groups.push({ key: region.key, label: region.label, hint: region.hint, styles })
    }
    // 新增但尚未录入旧分类的预设也必须可选，统一放入“影视写实”后由搜索查找。
    const unassigned = VISUAL_STYLE_PRESETS.map(style => style.key).filter(styleKey => !assigned.has(styleKey))
    groups[0].styles.push(...unassigned)
    return groups
})()

export function normalizeStyleForCreation(styleKey: string): string {
    return VISUAL_STYLE_PRESETS.some(style => style.key === styleKey) ? styleKey : 'cinematic'
}

export const ORDERED_VISUAL_STYLE_PRESETS = (() => {
    const orderedKeys = STYLE_GROUPS.flatMap(group => [...group.styles])
    const seen = new Set<string>()
    const ordered = orderedKeys
        .filter(key => !seen.has(key) && seen.add(key))
        .map(key => VISUAL_STYLE_PRESETS.find(style => style.key === key))
        .filter((style): style is VisualStylePreset => Boolean(style))
    return ordered
})()

export function getCreationStyleGroupLabel(styleKey: string, locale: Locale) {
    const group = STYLE_GROUPS.find(item => (item.styles as readonly string[]).includes(styleKey))
    return group ? localizeStyleCluster(locale, group).label : undefined
}

export const DEFAULT_FORM = {
    title: '',
    description: '',
    genre: DEFAULT_PROJECT_GENRE,
    totalEpisodes: 12,
    episodeFormat: 'micro',
    videoAspectRatio: '9:16',
    visualStyle: 'cinematic',
    contentLanguage: 'en' as Locale
}
