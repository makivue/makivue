import { SEEDANCE_20_BASE_URL, SEEDANCE_20_ENDPOINT_ID, SEEDANCE_25_BASE_URL, SEEDANCE_25_ENDPOINT_ID } from '@/lib/provider-capabilities'

export interface SeedanceConfig {
    apiKey: string
    baseUrl: string | null
    modelName: string | null
    extra: string | null
}

export async function getSeedanceConfig(variant: 'seedance' | 'seedance25' = 'seedance'): Promise<SeedanceConfig | null> {
    const runtimeApiKey = process.env.VOLCENGINE_ARK_API_KEY?.trim() || process.env.ARK_API_KEY?.trim() || process.env.BYTEPLUS_ARK_API_KEY?.trim()
    const apiKey = runtimeApiKey || process.env.SEEDANCE_API_KEY?.trim()
    if (!apiKey) return null

    return {
        apiKey,
        // 两个版本复用当前 Seedance Ark key，但使用各自 endpoint。
        baseUrl: (variant === 'seedance25' ? process.env.SEEDANCE_25_BASE_URL?.trim() || SEEDANCE_25_BASE_URL : process.env.SEEDANCE_20_BASE_URL?.trim() || SEEDANCE_20_BASE_URL).replace(/\/$/, ''),
        modelName: variant === 'seedance25' ? process.env.SEEDANCE_25_MODEL?.trim() || SEEDANCE_25_ENDPOINT_ID : process.env.SEEDANCE_20_MODEL?.trim() || SEEDANCE_20_ENDPOINT_ID,
        extra: null
    }
}
