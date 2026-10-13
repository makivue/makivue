/** Provider moderation rejections are definitive, not transient transport failures. */
export function isContentFilterError(error: unknown): boolean {
    if (error instanceof ProviderContentFilterError) return true
    const message = error instanceof Error ? error.message : String(error)
    return /content[_ -]?filter|content management policy|ResponsibleAIPolicyViolation|prompt triggering|内容(?:审核|安全).*(?:拦截|拒绝)/i.test(message)
}

export type ContentFilterDetails = {
    phase: 'input' | 'output' | 'unknown'
    categories: Array<{ category: string; severity?: string }>
    requestId: string | null
}

/** Only inspect moderation envelopes, never generated text or arbitrary provider fields. */
export function extractContentFilterDetails(payload: unknown, headers?: Headers, phase: ContentFilterDetails['phase'] = 'unknown'): ContentFilterDetails {
    const categories = new Map<string, { category: string; severity?: string }>()
    const bodyIds = new Map<string, string>()
    const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9._:/-]{1,128}$/i.test(value)
    const visited = new WeakSet<object>()
    let remaining = 100
    const visit = (value: unknown, depth: number) => {
        if (!value || typeof value !== 'object' || depth > 7 || remaining-- <= 0 || visited.has(value)) return
        visited.add(value)
        if (Array.isArray(value)) return value.slice(0, 12).forEach(child => visit(child, depth + 1))
        const record = value as Record<string, unknown>
        for (const key of ['request_id', 'requestId', 'gw_trace_id', 'gwTraceId', 'trace_id', 'traceId']) {
            if (validId(record[key]) && !bodyIds.has(key)) bodyIds.set(key, record[key])
        }
        for (const category of ['hate', 'sexual', 'violence', 'self_harm', 'jailbreak', 'protected_material_text', 'protected_material_code']) {
            const result = record[category]
            if (!result || typeof result !== 'object') continue
            const filter = result as Record<string, unknown>
            if (filter.filtered !== true && filter.detected !== true) continue
            const severity = typeof filter.severity === 'string' && /^(safe|low|medium|high)$/i.test(filter.severity) ? filter.severity.toLowerCase() : undefined
            categories.set(category, { category, ...(severity ? { severity } : {}) })
        }
        if (record.prompt_filter_results || record.prompt_feedback || record.promptFeedback) phase = phase === 'output' ? phase : 'input'
        if (typeof record.message === 'string' && /prompt triggering|prompt.*(?:blocked|filtered)/i.test(record.message) && phase !== 'output') phase = 'input'
        if (typeof record.param === 'string' && /^(prompt|messages|input)$/.test(record.param) && phase !== 'output') phase = 'input'
        for (const key of ['error', 'innererror', 'inner_error', 'data', 'response', 'metadata', 'choices', 'prompt_filter_results', 'content_filter_result', 'content_filter_results'])
            visit(record[key], depth + 1)
    }
    visit(payload, 0)
    const requestId =
        ['x-request-id', 'request-id', 'gw_trace_id', 'gw-trace-id', 'x-gw-trace-id', 'x-gw_trace_id', 'x-trace-id', 'cf-ray'].map(key => headers?.get(key)).find(validId) ??
        ['request_id', 'requestId', 'gw_trace_id', 'gwTraceId', 'trace_id', 'traceId'].map(key => bodyIds.get(key)).find(validId)
    return { phase, categories: [...categories.values()], requestId: requestId ?? null }
}

export class ProviderContentFilterError extends Error {
    readonly name = 'ProviderContentFilterError'
    constructor(
        readonly details: ContentFilterDetails,
        readonly status?: number
    ) {
        super(`content_filter: upstream moderation rejected ${details.phase}`)
    }
}

export function chapterContentFilterMessage(error: unknown): string {
    const details = error instanceof ProviderContentFilterError ? error.details : null
    const phase = details?.phase ?? 'unknown'
    const lead =
        phase === 'input' ? '正文生成输入被上游内容审核拒绝，本次未生成正文。' : phase === 'output' ? '正文输出被上游内容审核中断，未保存不完整正文。' : '正文生成被上游内容审核拒绝，未获得完整正文。'
    const labels: Record<string, string> = {
        hate: '仇恨',
        sexual: '色情',
        violence: '暴力',
        self_harm: '自伤',
        jailbreak: '提示词安全',
        protected_material_text: '受保护文本',
        protected_material_code: '受保护代码'
    }
    const categories = details?.categories.map(item => `${labels[item.category] ?? item.category}${item.severity ? `（${item.severity}）` : ''}`).join('、')
    return `${lead}${categories ? `审核类别：${categories}。` : '上游未提供具体审核类别。'}请调整本章大纲或相关设定中的违规描写后重试；重复提交相同内容不会自动解决。${details?.requestId ? ` 请求编号：${details.requestId}` : ''}`
}
