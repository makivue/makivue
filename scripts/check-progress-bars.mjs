import fs from 'node:fs/promises'
import path from 'node:path'
import { walkTypeScript } from './i18n-source-messages.mjs'

const root = process.cwd()
const files = (await walkTypeScript(path.join(root, 'src'))).filter(file => file.endsWith('.tsx'))
const dynamicPercentWidth = /style=\{\{\s*width:\s*`[^`]*%`[^}]*\}\}/g
const failures = []
let checked = 0

for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    for (const match of source.matchAll(dynamicPercentWidth)) {
        const index = match.index ?? 0
        const before = source.slice(Math.max(0, index - 400), index)
        const classNameIndex = before.lastIndexOf('className=')
        const fillMarkup = classNameIndex >= 0 ? before.slice(classNameIndex) : ''
        checked += 1
        if (!fillMarkup.includes('progress-flow')) {
            const line = source.slice(0, index).split('\n').length
            failures.push(`${path.relative(root, file)}:${line}: percentage-width progress fill must use progress-flow`)
        }
    }
}

const globalCss = await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8')
for (const requirement of ['@keyframes progress-flow-enter', '@keyframes progress-flow-sweep', '.progress-flow::after', '@media (prefers-reduced-motion: reduce)']) {
    if (!globalCss.includes(requirement)) failures.push(`src/app/globals.css: missing ${requirement}`)
}

if (failures.length) {
    console.error(`progress bar check failed\n${failures.join('\n')}`)
    process.exit(1)
}

console.log(`progress bar check passed: ${checked} animated percentage-width bars`)
