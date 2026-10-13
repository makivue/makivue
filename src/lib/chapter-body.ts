/** Accept only prose with an explicit boundary separating any model analysis. */
export function extractChapterBody(raw: string): string {
    let content = raw.trim()
    const fence = content.match(/^```(?:text|markdown)?\s*\n([\s\S]*?)\n```$/i)
    if (fence) content = fence[1].trim()

    content = content.replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim()
    if (/<\/?(?:think|thinking|analysis)\b/i.test(content)) throw new Error('模型返回了思考过程，无法明确提取完整正文，请重新生成')

    const analysisHeading = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?(?:Thinking[ \t]+Process|Thought[ \t]+Process|Analysis|Reasoning|思考过程|思维过程|分析过程)(?:\*\*)?[ \t]*[:：]?(?:\*\*)?[ \t]*$/im
    if (analysisHeading.test(content)) {
        // Never guess the first prose paragraph: analysis can contain draft passages.
        const finalHeading = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?(?:Final[ \t]+Answer|Final[ \t]+Response|Chapter[ \t]+Content|正文|小说正文|最终正文|最终回答)(?:\*\*)?[ \t]*[:：]?(?:\*\*)?[ \t]*\r?$/im
        const analysis = content.match(analysisHeading)!
        const remainder = content.slice(analysis.index! + analysis[0].length)
        const final = remainder.match(finalHeading)
        if (!final) throw new Error('模型返回了思考过程，无法明确提取完整正文，请重新生成')
        content = remainder.slice(final.index! + final[0].length).trim()
        if (analysisHeading.test(content)) throw new Error('模型返回了思考过程，无法明确提取完整正文，请重新生成')
    }

    if (!content) throw new Error('模型返回了空章节正文')
    return content
}
