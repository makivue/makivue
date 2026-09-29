import { describe, expect, it } from 'vitest'
import { providerQuotaBudgets } from './provider-quota-policy'

const endpoint = 'https://supplier.example/v1/responses'
const request = { method: 'POST', headers: { authorization: 'Bearer test-credential' }, body: JSON.stringify({ input: 'hello', max_output_tokens: 100 }) }

describe('shared supplier quota identity and policy', () => {
    it('shares aggregate limits across models and isolates different credentials', () => {
        const a = providerQuotaBudgets(endpoint, request, 'himodels', 'model-a', '')
        const b = providerQuotaBudgets(endpoint, request, 'himodels', 'model-b', '')
        expect(a.filter(budget => b.some(other => other.key === budget.key))).toHaveLength(1)
        expect(providerQuotaBudgets(endpoint, request, 'himodels', 'model-a', '')).toEqual(a)
        const other = providerQuotaBudgets(endpoint, { ...request, headers: { authorization: 'Bearer different' } }, 'himodels', 'model-a', '')
        expect(other.some(budget => a.some(original => original.key === budget.key))).toBe(false)
        expect(JSON.stringify(a)).not.toContain('test-credential')
    })

    it('uses the Vertex project across regions and rotating access tokens', () => {
        const a = providerQuotaBudgets('https://us-aiplatform.googleapis.com/v1/projects/project-a/locations/us/models/m', request, 'gemini', 'gemini:m', '')
        const b = providerQuotaBudgets(
            'https://eu-aiplatform.googleapis.com/v1/projects/project-a/locations/eu/models/m',
            { ...request, headers: { authorization: 'Bearer rotated' } },
            'gemini',
            'm',
            ''
        )
        expect(a).toEqual(b)
    })

    it('keeps status polling in a separate budget regardless of model/task ID', () => {
        const a = providerQuotaBudgets(endpoint + '/task1', { ...request, method: 'GET' }, 'himodels', 'a', '')
        const b = providerQuotaBudgets(endpoint + '/task2', { ...request, method: 'GET' }, 'himodels', 'b', '')
        expect(a).toEqual(b)
        expect(a).toHaveLength(1)
        expect(a[0]).toMatchObject({ requestsPerMinute: 600, concurrency: 32, tokens: 0 })
    })

    it('shares Kling capacity when per-request JWT timestamps rotate', () => {
        const token = (exp: number) => `Bearer header.${Buffer.from(JSON.stringify({ iss: 'test-access', exp })).toString('base64url')}.signature`
        const a = providerQuotaBudgets(endpoint, { ...request, headers: { authorization: token(100) } }, 'kling', 'video', '')
        const b = providerQuotaBudgets(endpoint, { ...request, headers: { authorization: token(200) } }, 'kling', 'video', '')
        expect(a).toEqual(b)
    })

    it('rejects invalid configuration and requests larger than the token budget', () => {
        expect(() => providerQuotaBudgets(endpoint, request, 'himodels', 'a', '{')).toThrow('JSON')
        expect(() => providerQuotaBudgets(endpoint, request, 'himodels', 'a', '{"himodels":{"concurrency":0}}')).toThrow()
        expect(() => providerQuotaBudgets(endpoint, request, 'himodels', 'a', '{"himodels":{"tokensPerMinute":1}}')).toThrow('Token')
        const budgets = providerQuotaBudgets(endpoint, request, 'himodels', 'a', '{"himodels":{"concurrency":2,"requestsPerMinute":10,"tokensPerMinute":100000}}')
        expect(budgets.find(b => b.concurrency === 2)).toMatchObject({ requestsPerMinute: 10, tokensPerMinute: 100000 })
        expect(budgets.find(b => b.concurrency === 2)!.tokens).toBeGreaterThan(100)
    })
})
