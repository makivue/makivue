import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { walkTypeScript } from './i18n-source-messages.mjs'

const root = process.cwd()
const files = await walkTypeScript(path.join(root, 'src'))
const failures = []
let fetchCount = 0

for (const file of files) {
    const text = await fs.readFile(file, 'utf8')
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
            fetchCount += 1
            const options = node.arguments[1]
            const hasSignal = options && ts.isObjectLiteralExpression(options) && options.properties.some(property =>
                (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name?.getText(sourceFile) === 'signal'
            )
            if (!hasSignal) {
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
                failures.push(`${path.relative(root, file)}:${line}`)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
}

if (failures.length) {
    console.error(`fetch timeout check failed: ${failures.length} fetch calls have no explicit signal\n${failures.join('\n')}`)
    process.exit(1)
}
console.log(`fetch timeout check passed: ${fetchCount} direct fetch calls have explicit deadlines`)
