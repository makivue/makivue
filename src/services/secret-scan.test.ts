import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const scanner = path.join(process.cwd(), 'scripts/check-committed-secrets.mjs')
let root: string
const syntheticToken = ['sk', '-', 'x'.repeat(24)].join('')
function git(...args: string[]) {
    return execFileSync('git', args, { cwd: root, stdio: 'pipe' })
}
function check(...args: string[]) {
    return spawnSync(process.execPath, [scanner, ...args], { cwd: root, encoding: 'utf8' })
}
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-secret-scan-'))
    git('init', '-q')
    git('config', 'user.name', 'Test Contributor')
    git('config', 'user.email', 'test@example.invalid')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('public repository secret gate', () => {
    it('finds a staged token even after the working file is cleaned, without printing the token', () => {
        fs.writeFileSync(path.join(root, 'sample.txt'), syntheticToken)
        git('add', 'sample.txt')
        fs.writeFileSync(path.join(root, 'sample.txt'), 'clean')
        const result = check()
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('index:sample.txt')
        expect(result.stdout + result.stderr).not.toContain(syntheticToken)
    })

    it('finds a removed token in history while the current tree and index are clean', () => {
        fs.writeFileSync(path.join(root, 'sample.txt'), syntheticToken)
        git('add', 'sample.txt')
        git('commit', '-qm', 'fixture')
        fs.writeFileSync(path.join(root, 'sample.txt'), 'clean')
        git('add', 'sample.txt')
        git('commit', '-qm', 'clean fixture')
        expect(check().status).toBe(0)
        const result = check('--history')
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('history:sample.txt')
        expect(result.stdout + result.stderr).not.toContain(syntheticToken)
    })

    it('blocks tracked environment files even when their content is harmless', () => {
        fs.writeFileSync(path.join(root, '.env.test'), 'EXAMPLE=1')
        git('add', '.env.test')
        expect(check().stderr).toContain('credential/config file must not be tracked')
    })

    it('detects the ordinary private-key header, not just RSA-prefixed headers', () => {
        fs.writeFileSync(path.join(root, 'sample.txt'), ['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
        const result = check()
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('contains private key')
    })

    it('checks removed reference fingerprints in both paths and commit metadata', () => {
        const marker = 'retired-fixture'
        const digest = createHash('sha256').update(marker.replace('-', '')).digest('hex')
        const gate = path.join(root, 'gate.mjs')
        fs.writeFileSync(gate, fs.readFileSync(scanner, 'utf8').replace('const removedReferenceHashes = new Set([', `const removedReferenceHashes = new Set(['${digest}',`))
        fs.writeFileSync(path.join(root, `${marker}.txt`), 'clean content')
        const run = (...args: string[]) => spawnSync(process.execPath, [gate, ...args], { cwd: root, encoding: 'utf8' })
        expect(run().status).toBe(1)
        fs.renameSync(path.join(root, `${marker}.txt`), path.join(root, 'sample.txt'))
        git('add', 'sample.txt')
        git('commit', '-qm', marker)
        expect(run().status).toBe(0)
        const result = run('--history')
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('history:(metadata)')
        expect(result.stdout + result.stderr).not.toContain(marker)
    })
})
