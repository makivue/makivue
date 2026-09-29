/** Shared by Qwen images, Wan/Happy Horse videos and creator task polling. */
export function getDashScopeConfig() {
    return {
        apiKey: process.env.HAPPY_HORSE_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || null,
        baseUrl: (process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com').replace(/\/$/, ''),
        modelName: null
    }
}
