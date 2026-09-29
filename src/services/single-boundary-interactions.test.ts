import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function uiFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) return uiFiles(file)
        return /\.(?:tsx|css)$/.test(file) && !/\.(?:test|spec)\.tsx$/.test(file) ? [file] : []
    })
}

const files = ['src/app', 'src/components'].flatMap(directory => uiFiles(path.join(process.cwd(), directory)))

describe('single-boundary interaction styling', () => {
    it('does not reintroduce detached focus outlines or interaction rings', () => {
        for (const file of files) {
            const source = fs.readFileSync(file, 'utf8')
            expect(source, file).not.toMatch(/\b(?:focus|focus-visible|focus-within|hover|active):ring-/)
            expect(source, file).not.toMatch(/\b(?:focus|focus-visible):outline-offset-[1-9]/)
            expect(source, file).not.toMatch(/shadow-\[(?:inset_)?0_0_0_[1-9]/)
            if (file.endsWith('.css')) {
                expect(source, file).not.toMatch(/outline-offset:\s*[1-9]/)
                expect(source, file).not.toMatch(/box-shadow:\s*(?:inset\s+)?0\s+0\s+0\s+[1-9]/)
            }
        }
    })

    it('does not combine border and ring classes on the same UI element', () => {
        for (const file of files.filter(file => file.endsWith('.tsx'))) {
            const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
            const visit = (node: ts.Node) => {
                if (ts.isJsxAttribute(node) && node.name.getText(source) === 'className' && node.initializer) {
                    const classes = node.initializer.getText(source)
                    if (/\bborder(?:\s|-[\w[])/.test(classes)) expect(classes, `${file}: ${source.getLineAndCharacterOfPosition(node.pos).line + 1}`).not.toMatch(/\bring-[1-9]/)
                }
                ts.forEachChild(node, visit)
            }
            visit(source)
        }
    })

    it('retains a visible keyboard-focus edge without an outside gap', () => {
        const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
        expect(css).toContain(":is(button, a[href], summary, [role='button'], [tabindex]:not([tabindex='-1'])):focus-visible")
        expect(css).toContain('outline: 2px solid var(--app-accent);\n    outline-offset: -2px;')
        expect(css).toContain('.global-preferences-language:has(input:focus-visible)')
    })
})
