import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// Run in the Alpine dependency stage, using that stage's architecture. Next
// still needs SWC to load next.config.ts at startup on supported Node versions.
const require = createRequire(path.join(process.cwd(), 'package.json'))
const target = `swc-linux-${process.arch}-musl`
const scope = path.join(process.cwd(), 'node_modules', '@next')

// Load the native binding before removing anything. An absent or incompatible
// target must fail the image build instead of shipping a broken Next server.
require(`@next/${target}`)
for (const name of fs.readdirSync(scope)) {
    if (name.startsWith('swc-') && name !== target) fs.rmSync(path.join(scope, name), { recursive: true })
}
console.log(`[runtime] Retained @next/${target}`)
