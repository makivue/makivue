export const APP_THEMES = [
    { id: 'quantum', name: '量子冰蓝', hint: '深空黑 · 冰蓝能量', colors: ['#68e8ff', '#a6bdff'], tone: 'dark' },
    { id: 'nebula', name: '星云霓紫', hint: '午夜黑 · 紫粉辉光', colors: ['#c4a5ff', '#ff9bdd'], tone: 'dark' },
    { id: 'obsidian', name: '黑曜鎏金', hint: '曜石黑 · 香槟金属', colors: ['#f4d58b', '#ddb563'], tone: 'dark' },
    { id: 'matrix', name: '翡翠矩阵', hint: '墨绿黑 · 翡翠流光', colors: ['#73efbd', '#59dbdf'], tone: 'dark' },
    { id: 'aurora', name: '极光蓝', hint: '冷静科技', colors: ['#61e8ff', '#6378ff'], tone: 'dark' },
    { id: 'graphite', name: '石墨冰蓝', hint: '深灰底 · 冰蓝点缀', colors: ['#191c22', '#7dd3fc'], tone: 'dark' },
    { id: 'amber', name: '曜石琥珀', hint: '暖黑底 · 鲜明橙光', colors: ['#1c1a17', '#ffcd70'], tone: 'dark' },
    { id: 'plasma', name: '电光紫', hint: '午夜紫 · 霓虹玫红', colors: ['#d1c6ff', '#ff79c6'], tone: 'dark' },
    { id: 'ion', name: '霓虹青柠', hint: '碳黑底 · 荧光青柠', colors: ['#c5f86b', '#56e0b1'], tone: 'dark' },
    { id: 'glacier', name: '冰川青', hint: '深海底 · 冰青高光', colors: ['#64f4df', '#5fc2ff'], tone: 'dark' },
    { id: 'polar', name: '极地白', hint: '冷白底 · 电蓝对比', colors: ['#f4f7fa', '#123caa'], tone: 'light' },
    { id: 'juhuo', name: '剧火黑橙', hint: '炭黑底 · 白色按钮 · 橙红光晕', colors: ['#1d1d1d', '#ff9b48'], tone: 'dark' },
    { id: 'cobalt', name: '钴蓝纸', hint: '清晰逻辑', colors: ['#2851e3', '#0b5bd3'], tone: 'light' },
    { id: 'classic', name: 'makivue 紫', hint: '当前项目主题', colors: ['#c6a8ff', '#7546c8'], tone: 'dark' }
] as const

export type AppTheme = (typeof APP_THEMES)[number]['id']
type AppThemeTone = (typeof APP_THEMES)[number]['tone']

export const DEFAULT_APP_THEME: AppTheme = 'aurora'
const APP_THEME_STORAGE_KEY = 'local-studio-app-theme'
const APP_THEME_CHANGE_EVENT = 'local-studio-app-theme-change'
const LEGACY_HOME_THEME_STORAGE_KEY = 'local-studio-home-theme'

function isAppTheme(value: string | null): value is AppTheme {
    return APP_THEMES.some(theme => theme.id === value)
}

function appThemeTone(theme: AppTheme): AppThemeTone {
    return APP_THEMES.find(item => item.id === theme)?.tone ?? 'dark'
}

export function getAppThemeSnapshot(): AppTheme {
    if (typeof window === 'undefined') return DEFAULT_APP_THEME
    try {
        const savedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
        if (savedTheme === 'carbon') return DEFAULT_APP_THEME
        if (isAppTheme(savedTheme)) return savedTheme
        const legacyTheme = window.localStorage.getItem(LEGACY_HOME_THEME_STORAGE_KEY)
        return isAppTheme(legacyTheme) ? legacyTheme : DEFAULT_APP_THEME
    } catch {
        return DEFAULT_APP_THEME
    }
}

function applyAppTheme(theme: AppTheme) {
    const root = document.documentElement
    root.dataset.appTheme = theme
    root.dataset.appTone = appThemeTone(theme)
    root.dataset.homeTheme = theme
}

export function saveAppTheme(theme: AppTheme) {
    try {
        window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
    } catch {
        // The active document still receives the theme when storage is blocked.
    }
    applyAppTheme(theme)
    window.dispatchEvent(new Event(APP_THEME_CHANGE_EVENT))
}

export function subscribeToAppTheme(listener: () => void) {
    if (typeof window === 'undefined') return () => undefined
    const update = () => {
        applyAppTheme(getAppThemeSnapshot())
        listener()
    }
    window.addEventListener(APP_THEME_CHANGE_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
        window.removeEventListener(APP_THEME_CHANGE_EVENT, update)
        window.removeEventListener('storage', update)
    }
}

export const APP_THEME_BOOTSTRAP_SCRIPT = `(()=>{try{const p=${JSON.stringify(Object.fromEntries(APP_THEMES.map(theme => [theme.id, theme.tone])))},a=Object.keys(p),k='${APP_THEME_STORAGE_KEY}',l='${LEGACY_HOME_THEME_STORAGE_KEY}',s=localStorage.getItem(k),v=s==='carbon'?'${DEFAULT_APP_THEME}':a.includes(s)?s:localStorage.getItem(l),t=a.includes(v)?v:'${DEFAULT_APP_THEME}',r=document.documentElement;r.dataset.appTheme=t;r.dataset.homeTheme=t;r.dataset.appTone=p[t];if(!a.includes(s)){try{localStorage.setItem(k,t)}catch{}}}catch{const r=document.documentElement;r.dataset.appTheme='${DEFAULT_APP_THEME}';r.dataset.homeTheme='${DEFAULT_APP_THEME}';r.dataset.appTone='${appThemeTone(DEFAULT_APP_THEME)}'}})()`
