import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { walkTypeScript } from './i18n-source-messages.mjs'

const root = process.cwd()
const apiRoot = path.join(root, 'src', 'app', 'api')
const files = (await walkTypeScript(apiRoot)).filter(file => file.endsWith(`${path.sep}route.ts`) && !file.includes(`${path.sep}admin${path.sep}`))
const riskyCalls = new Set([
    'chat',
    'chatJSON',
    'chatGemini',
    'detectAndParseScript',
    'extractCharactersAndScenesBatched',
    'generatePersonalStoryDirections',
    'generateProjectStyleReference',
    'generateImageUnified',
    'generateCharacterReference',
    'generateSceneReference',
    'generateFrame',
    'generateVideo'
])
const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const failures = []
let reviewedRoutes = 0

for (const file of files) {
    const text = await fs.readFile(file, 'utf8')
    const reviewed = text.includes('gateway-duration-reviewed')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

    for (const statement of source.statements) {
        if (!ts.isFunctionDeclaration(statement) || !statement.name || !httpMethods.has(statement.name.text)) continue
        const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
        if (!exported || !statement.body) continue

        const visit = node => {
            if (node !== statement && ts.isFunctionLike(node)) return
            if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
                const expression = node.expression.expression
                const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : ''
                if (riskyCalls.has(name) && !reviewed) {
                    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
                    failures.push(`${path.relative(root, file)}:${line} directly awaits ${name}() inside ${statement.name.text}`)
                }
            }
            ts.forEachChild(node, visit)
        }
        visit(statement.body)
    }
    if (reviewed) reviewedRoutes += 1
}

if (failures.length) {
    console.error(
        `API duration risk check failed:\n${failures.join('\n')}\nMove long work to a persisted background job, or add a gateway-duration-reviewed comment with an explicit sub-gateway deadline.`
    )
    process.exit(1)
}

console.log(`API duration risk check passed: ${files.length} routes scanned, ${reviewedRoutes} explicitly bounded synchronous route(s)`)
