import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createKlingJwt, parseKlingCredentials } from './kling-comparison'

describe('Kling comparison authentication', () => {
    it('requires an access and secret pair', () => {
        expect(parseKlingCredentials('access:secret')).toEqual({ accessKey: 'access', secretKey: 'secret' })
        expect(() => parseKlingCredentials('access-only')).toThrow(/Access Key:Secret Key/)
    })

    it('creates an HS256 token with a bounded lifetime', () => {
        const token = createKlingJwt('access', 'secret', 1000)
        const [header, payload, signature] = token.split('.')
        expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' })
        expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ iss: 'access', exp: 2800, nbf: 995 })
        expect(signature).toBe(createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url'))
    })

    it('keeps comparison output isolated from the storyboard main video', () => {
        const service = fs.readFileSync(path.join(process.cwd(), 'src/services/kling-comparison.ts'), 'utf8')
        const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/storyboards/[id]/compare-kling/route.ts'), 'utf8')
        expect(route).toContain("type: 'video_comparison'")
        expect(route).toContain('isHighDynamicVideoShot')
        expect(route).toContain('assertSufficientPoints(userId')
        expect(service).not.toContain('prisma.storyboard.update')
        expect(service).toContain('comparisonOnly: true')
        expect(service).toContain('chargeModelUsage({')
    })
})
