import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'
const request = (path: string, headers?: Record<string, string>) => new NextRequest(`http://localhost:3000${path}`, { headers })
describe('local workspace boundary', () => {
    it('allows loopback access without cloud login', async () => {
        expect((await proxy(request('/api/projects'))).status).toBe(200)
        expect((await proxy(request('/api/projects', { authorization: 'forged' }))).status).toBe(200)
    })
    it('rejects external hosts, cross-site requests and mismatched origins', async () => {
        expect((await proxy(new NextRequest('https://attacker.example/api/projects'))).status).toBe(403)
        expect((await proxy(request('/api/projects', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
        expect((await proxy(request('/api/projects', { origin: 'https://attacker.example' }))).status).toBe(403)
        expect((await proxy(request('/api/projects', { origin: 'http://localhost:3000' }))).status).toBe(200)
        expect((await proxy(request('/api/projects', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }))).status).toBe(200)
    })
    it('never allows payment endpoints', async () => {
        expect((await proxy(request('/api/wallet/recharge'))).status).toBe(410)
        expect((await proxy(request('/api/wallet/webhook/external'))).status).toBe(410)
    })
    it('preserves local locale routing and bookmark redirects', async () => {
        expect((await proxy(request('/zh/projects'))).headers.get('x-middleware-rewrite')).toBe('http://localhost:3000/projects')
        expect((await proxy(request('/en/projects'))).headers.get('location')).toBe('http://localhost:3000/projects')
        expect((await proxy(request('/ko/create/video'))).headers.get('location')).toBe('http://localhost:3000/ko/aivideo')
    })
})
