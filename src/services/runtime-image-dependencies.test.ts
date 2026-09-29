import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const script = path.join(process.cwd(), 'scripts/prune-runtime-swc.mjs')
const target = `swc-linux-${process.arch}-musl`

function fixture(run: (root: string, scope: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-swc-'))
    const scope = path.join(root, 'node_modules', '@next')
    fs.mkdirSync(scope, { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    try {
        run(root, scope)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
}

function packageFixture(scope: string, name: string, source = 'module.exports = {}') {
    fs.mkdirSync(path.join(scope, name))
    fs.writeFileSync(path.join(scope, name, 'index.js'), source)
}

describe('Alpine runtime SWC dependencies', () => {
    it('retains the matching musl binding and unrelated packages while removing other SWC targets', () => {
        fixture((root, scope) => {
            packageFixture(scope, target)
            packageFixture(scope, `swc-linux-${process.arch}-gnu`)
            packageFixture(scope, 'swc-darwin-x64')
            packageFixture(scope, 'env')
            const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
            expect(run.status, run.stderr).toBe(0)
            expect(fs.readdirSync(scope).sort()).toEqual(['env', target].sort())
        })
    })

    it.each(['missing', 'incompatible'])('leaves all packages intact if the target binding is %s', failure => {
        fixture((root, scope) => {
            packageFixture(scope, `swc-linux-${process.arch}-gnu`)
            if (failure === 'incompatible') packageFixture(scope, target, "throw new Error('incompatible native binding')")
            const before = fs.readdirSync(scope).sort()
            const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
            expect(run.status).not.toBe(0)
            expect(fs.readdirSync(scope).sort()).toEqual(before)
        })
    })
})
