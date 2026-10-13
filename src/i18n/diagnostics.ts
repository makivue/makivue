import { isLocalizedCatalogMessage, translateDiagnosticFragments, translateMessage } from './catalog'
import type { Locale } from './config'
import { getGenerationErrorGuidance } from '@/lib/generation-error-guidance'

export function localizeDiagnostic(locale: Locale, source: string, kind: 'error' | 'notice' = 'error') {
    const translated = translateDiagnosticFragments(locale, source)
    if (translated === source && isLocalizedCatalogMessage(locale, source)) return { text: source, original: null }
    const uncoveredChinese = locale !== 'zh' && /\p{Script=Han}/u.test(source) && (translated === source || (locale !== 'ja' && /\p{Script=Han}/u.test(translated)))
    // Async callers sometimes already translated the message. Do not mistake
    // French/Indonesian/etc. copy for English just because it uses Latin letters.
    const uncoveredEnglish =
        locale !== 'en' &&
        translated === source &&
        /^[\x20-\x7e\s]+$/.test(source) &&
        /\b(?:error|failed|failure|denied|rejected|invalid|timeout|unavailable|not found|not configured|timed out)\b/i.test(source)
    if (!uncoveredChinese && !uncoveredEnglish) return { text: translated, original: null }

    // Provider errors and model-written review messages are an open set. Never
    // expose an untranslated diagnostic as the main UI message; keep its exact
    // original available for inspection/copying through the shared component.
    const guidance = getGenerationErrorGuidance(source)
    const label = kind === 'notice' ? '提示' : source.startsWith('剧本质量检查未通过：') ? '剧本质量检查未通过：' : guidance.kind === 'unknown' ? '请求失败' : guidance.title
    return { text: translateMessage(locale, label), original: source }
}
