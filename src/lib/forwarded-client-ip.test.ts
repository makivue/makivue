import { describe, expect, it } from 'vitest'
import { getForwardedClientIp } from './forwarded-client-ip'

describe('forwarded client IP', () => {
    const cases: { name: string; headers: Record<string, string>; expected?: string }[] = [
        {
            name: 'prefers the first forwarded address and trims whitespace',
            headers: { 'X-Forwarded-For': ' 203.0.113.7 , 198.51.100.10', 'X-Real-IP': '203.0.113.8', 'CF-Connecting-IP': '203.0.113.9' },
            expected: '203.0.113.7'
        },
        { name: 'falls back to real IP', headers: { 'X-Real-IP': '203.0.113.8', 'CF-Connecting-IP': '203.0.113.9' }, expected: '203.0.113.8' },
        { name: 'falls back to Cloudflare IP', headers: { 'CF-Connecting-IP': '203.0.113.9' }, expected: '203.0.113.9' },
        {
            name: 'does not select a downstream proxy when the first forwarded address is invalid',
            headers: { 'X-Forwarded-For': 'unknown, 198.51.100.10', 'X-Real-IP': '203.0.113.8' },
            expected: '203.0.113.8'
        },
        { name: 'accepts IPv6', headers: { 'X-Forwarded-For': '2001:db8::7, 198.51.100.10' }, expected: '2001:db8::7' },
        { name: 'accepts IPv4-mapped IPv6', headers: { 'X-Real-IP': '::ffff:203.0.113.8' }, expected: '::ffff:203.0.113.8' },
        { name: 'omits missing IPs', headers: {} },
        { name: 'omits empty IPs', headers: { 'X-Forwarded-For': ' , 198.51.100.10', 'X-Real-IP': ' ' } },
        { name: 'omits invalid IPs', headers: { 'X-Forwarded-For': '999.1.1.1', 'X-Real-IP': 'example.com', 'CF-Connecting-IP': '203.0.113.9:443' } }
    ]

    it.each(cases)('$name', ({ headers, expected }) => {
        expect(getForwardedClientIp(new Headers(headers))).toBe(expected)
    })
})
