import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { translateMessage } from './catalog'
import { locales } from './config'

function uiFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) return entry.name === 'api' ? [] : uiFiles(file)
        return /\.tsx?$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file) ? [file] : []
    })
}

const samples: Array<{ location: string; message: string }> = []
for (const file of ['src/app', 'src/components'].flatMap(directory => uiFiles(directory))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
        if (ts.isTemplateExpression(node)) {
            const message = node.head.text + node.templateSpans.map(span => `7${span.literal.text}`).join('')
            if (/\p{Script=Han}/u.test(message)) {
                // Include helper-generated labels and async toast/error messages,
                // not just templates embedded directly in JSX.
                samples.push({ location: `${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`, message })
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
}

describe('dynamic UI message coverage', () => {
    it.each(locales.filter(locale => locale !== 'zh' && locale !== 'ja'))('does not leak Chinese after adding counts and IDs in %s', locale => {
        expect(samples.length).toBeGreaterThan(0)
        const missing = samples.filter(sample => /\p{Script=Han}/u.test(translateMessage(locale, sample.message)))
        expect(missing).toEqual([])
    })
})
