import { describe, expect, it } from 'vitest'
import { chat } from './llm'

describe.skipIf(process.env.RUN_GPT_INTEGRATION !== '1')('Azure GPT deployments integration', () => {
    for (const model of ['gpt-5.4-shortdrama', 'gpt-5.5-shortdrama']) {
        it(`${model} returns text`, async () => {
            const result = await chat(
                [
                    { role: 'system', content: 'Reply with exactly the word OK.' },
                    { role: 'user', content: 'Connectivity check.' }
                ],
                { model, maxTokens: 32, temperature: 0, timeoutMs: 60_000, attempts: 1 }
            )
            expect(result.trim().length).toBeGreaterThan(0)
        }, 90_000)
    }
})
