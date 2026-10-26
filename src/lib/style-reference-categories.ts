/** Non-exclusive creative references, independent of rendering style and regional filters. */
export const STYLE_REFERENCE_CATEGORIES = [
    {
        key: 'daily-comedy',
        label: '日常与喜剧',
        styles: ['cozy-sitcom', 'mockumentary-comedy', 'smartphone-pov', 'healing-romance', 'social-realism', 'animal-city-comedy', 'retro-rubber-hose', 'photoreal-pet-drama']
    },
    {
        key: 'romance',
        label: '爱情与情感',
        styles: [
            'modern-drama',
            'korean-clean',
            'luxury-romance',
            'soft-idol-drama',
            'campus-romance',
            'office-romance',
            'rainy-neon-romance',
            'vintage-romance',
            'summer-romance',
            'sea-sweet-romance',
            'eu-urban-relationships',
            'french-romance',
            'ghost-romance'
        ]
    },
    {
        key: 'growth-family',
        label: '家庭与成长',
        styles: [
            'modern-family-animation',
            'family-ethics',
            'sea-family-ethics',
            'eu-womens-growth',
            'eu-inspirational-journey',
            'family-road-adventure',
            'pet-adventure',
            'dinosaur-family-animation',
            'american-highschool',
            'healing-romance'
        ]
    },
    {
        key: 'revenge-work',
        label: '逆袭与职场',
        styles: [
            'na-urban-revenge',
            'na-workplace-comeback',
            'sea-rebirth-revenge',
            'eu-heroine-comeback',
            'business-war',
            'office-romance',
            'legal-drama',
            'medical-drama',
            'sea-dynasty-feud',
            'eu-family-dynasty'
        ]
    },
    {
        key: 'suspense-horror',
        label: '悬疑与恐怖',
        styles: [
            'found-footage',
            'analog-horror',
            'suspense-noir',
            'hk-crime',
            'nordic-noir',
            'na-hardboiled-mystery',
            'na-thriller-twist',
            'me-crime-mystery',
            'thai-supernatural',
            'cosmic-horror',
            'noir-anime'
        ]
    },
    {
        key: 'history-war',
        label: '历史与战争',
        styles: [
            'ancient-indian-war',
            'rajput-fortress-war',
            'ancient-egypt-epic',
            'ancient-greek-epic',
            'roman-legion-epic',
            'viking-saga',
            'medieval-knights',
            'ancient-persian-epic',
            'three-kingdoms-epic',
            'mesoamerican-epic',
            'tang-dynasty',
            'song-dynasty',
            'ottoman-period',
            'british-period',
            'modern-war',
            'ww2-war',
            'resistance-war',
            'naval-war',
            'trench-war',
            'samurai-war'
        ]
    },
    {
        key: 'fantasy',
        label: '奇幻与神话',
        styles: [
            'xianxia',
            'wuxia-realism',
            'wuxia-ink',
            'chinese-ink',
            'mythic-fantasy',
            'indian-mythology',
            'arabian-nights',
            'dark-fantasy',
            'vampire-gothic',
            'werewolf-alpha',
            'enchanted-forest',
            'princess-fairytale',
            'celtic-folklore',
            'maori-legend'
        ]
    },
    {
        key: 'future',
        label: '科幻与未来',
        styles: [
            'cyberpunk',
            'hard-sci-fi',
            'alien-contact',
            'space-opera',
            'robot-society',
            'retro-futurism',
            'solarpunk',
            'afrofuturism',
            'mecha-anime',
            'interstellar-ark',
            'post-apocalyptic',
            'pixel-art'
        ]
    },
    {
        key: 'nature-pets',
        label: '自然与萌宠',
        styles: [
            'photoreal-pet-drama',
            'pet-adventure',
            'african-wildlife',
            'rainforest-wildlife',
            'ocean-wildlife',
            'arctic-wildlife',
            'insect-micro-world',
            'bird-migration',
            'animal-family-doc',
            'wolf-pack',
            'big-cat-kingdom',
            'savanna-animal-kingdom',
            'forest-animal-adventure'
        ]
    },
    {
        key: 'travel',
        label: '旅行与人文',
        styles: [
            'travel-diary',
            'architecture-tour',
            'japanese-festival',
            'southeast-asia-street',
            'andean-folklore',
            'mongolian-steppe',
            'central-asian-silk-road',
            'mexican-day-dead',
            'levantine-old-city',
            'ethiopian-highland',
            'ocean-voyage',
            'train-cross-continent',
            'aussie-outback'
        ]
    },
    {
        key: 'sports-music',
        label: '运动与音乐',
        styles: ['outdoor-sports', 'stage-musical', 'sports-anime', 'hiphop-street', 'bollywood', 'latin-carnival', 'mountain-climbing', 'river-rafting', 'ocean-voyage']
    },
    {
        key: 'food-lifestyle',
        label: '美食与生活方式',
        styles: ['cooking-macro', 'surreal-asmr', 'cozy-sitcom', 'healing-romance', 'travel-diary', 'smartphone-pov', 'architecture-tour', 'miniature-diorama']
    },
    {
        key: 'commercial',
        label: '广告与产品',
        styles: ['product-commercial', 'fashion-editorial', 'cooking-macro', 'isometric-3d', 'hyperreal-3d', 'holographic-3d', 'editorial-illustration', 'sticker-art', 'architecture-tour']
    },
    {
        key: 'learning',
        label: '知识与科普',
        styles: ['science-explainer', 'architecture-tour', 'human-origins', 'evolutionary-journey', 'solar-system-epic', 'cosmic-birth', 'insect-micro-world', 'ocean-wildlife', 'hard-sci-fi']
    }
] as const

export function matchesStyleReferenceCategory(styleKey: string, category: string): boolean {
    const selected = STYLE_REFERENCE_CATEGORIES.find(item => item.key === category)
    return !selected || (selected.styles as readonly string[]).includes(styleKey)
}
