export const PROJECT_GENRES = [
    { code: 'drama', label: '剧情' },
    { code: 'romance', label: '爱情' },
    { code: 'comedy', label: '喜剧' },
    { code: 'thriller', label: '惊悚' },
    { code: 'mystery', label: '悬疑 / 推理' },
    { code: 'crime', label: '犯罪' },
    { code: 'action', label: '动作' },
    { code: 'adventure', label: '冒险' },
    { code: 'horror', label: '恐怖' },
    { code: 'sci_fi', label: '科幻' },
    { code: 'fantasy', label: '奇幻' },
    { code: 'historical', label: '历史 / 年代' },
    { code: 'family', label: '家庭' },
    { code: 'coming_of_age', label: '青春成长' },
    { code: 'urban', label: '都市' },
    { code: 'xuanhuan', label: '玄幻' },
    { code: 'wealthy_family', label: '豪门' },
    { code: 'political_intrigue', label: '权谋' },
    { code: 'xianxia', label: '仙侠' }
] as const

export type ProjectGenreLabel = (typeof PROJECT_GENRES)[number]['label']

export const DEFAULT_PROJECT_GENRE: ProjectGenreLabel = '剧情'
export const PROJECT_GENRE_LABELS = PROJECT_GENRES.map(genre => genre.label)
export const PROJECT_GENRE_PROMPT = PROJECT_GENRE_LABELS.join('、')

const GENRE_BY_LABEL = new Map<string, ProjectGenreLabel>(PROJECT_GENRES.map(genre => [genre.label.toLocaleLowerCase(), genre.label]))
const LEGACY_GENRE_ALIASES: Record<string, ProjectGenreLabel> = {
    现代: '剧情',
    言情: '爱情',
    古风: '历史 / 年代',
    古装: '历史 / 年代',
    历史: '历史 / 年代',
    民国: '历史 / 年代',
    职场: '剧情',
    校园: '青春成长',
    推理: '悬疑 / 推理',
    suspense: '悬疑 / 推理',
    mystery: '悬疑 / 推理',
    drama: '剧情',
    romance: '爱情',
    comedy: '喜剧',
    thriller: '惊悚',
    crime: '犯罪',
    action: '动作',
    adventure: '冒险',
    horror: '恐怖',
    'sci-fi': '科幻',
    'science fiction': '科幻',
    fantasy: '奇幻',
    historical: '历史 / 年代',
    period: '历史 / 年代',
    family: '家庭',
    teen: '青春成长',
    'coming-of-age': '青春成长'
}

export function canonicalProjectGenreLabel(value: unknown): ProjectGenreLabel | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim().toLocaleLowerCase()
    if (!normalized) return null
    return GENRE_BY_LABEL.get(normalized) ?? LEGACY_GENRE_ALIASES[normalized] ?? null
}
