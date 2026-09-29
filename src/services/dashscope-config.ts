/** Shared by Qwen images, Wan videos and historical DashScope task polling. */
export function getDashScopeConfig() {
    return {
        apiKey: process.env.DASHSCOPE_API_KEY?.trim() || null,
        baseUrl: (process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com').replace(/\/$/, ''),
        modelName: null
    }
}
