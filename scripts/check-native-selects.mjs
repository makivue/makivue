import fs from 'node:fs/promises'
import path from 'node:path'
import { walkTypeScript } from './i18n-source-messages.mjs'

const root = process.cwd()
const files = (await walkTypeScript(path.join(root, 'src'))).filter(file => file.endsWith('.tsx'))
const failures = []

for (const file of files) {
    const text = await fs.readFile(file, 'utf8')
    for (const match of text.matchAll(/<select\b/g)) {
        const line = text.slice(0, match.index).split('\n').length
        failures.push(`${path.relative(root, file)}:${line}`)
    }
}

if (failures.length > 0) {
    console.error(`Native select check failed. Use src/components/CustomSelect.tsx instead:\n${failures.join('\n')}`)
    process.exit(1)
}

console.log(`Native select check passed: ${files.length} TSX files scanned`)
