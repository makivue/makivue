import type { Locale } from './config'
import { translateMessage } from './catalog'

const en = { print: 'Print / Save PDF', contents: 'Contents', contentsLabel: 'Document contents', top: 'Back to top' }
const zh: typeof en = { print: '打印 / 保存 PDF', contents: '目录', contentsLabel: '文档目录', top: '返回顶部' }

export function legalPageCopy(locale: Locale): typeof en {
    if (locale === 'en') return en
    if (locale === 'zh') return zh
    return Object.fromEntries(Object.entries(zh).map(([key, value]) => [key, translateMessage(locale, value)])) as typeof en
}
