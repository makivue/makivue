import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const sourceRoots = ['src/app', 'src/components', 'src/services', 'src/lib']
const sourceFiles = ['src/proxy.ts']
const localizedMessageObjects = [
    { file: 'src/i18n/faq.ts', names: new Set(['zh']) },
    { file: 'src/i18n/legal-ui.ts', names: new Set(['zh']) }
]

const translatedAttributes = new Set(['placeholder', 'title', 'aria-label', 'alt'])
const translatedProperties = new Set(['label', 'title', 'description', 'hint', 'message', 'confirmText', 'cancelText', 'emptyText', 'loadingText', 'placeholder'])
const translatedCalls = new Map([
    ['t', [0]],
    ['translateMessage', [1]],
    ['apiError', [0]],
    ['handleApiError', [1]],
    ['setError', [0]],
    ['setMessage', [0]],
    ['showToast', [0]],
    ['pushToast', [1]],
    ['localizedPrivateMetadata', [0, 1]]
])

export async function walkTypeScript(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...(await walkTypeScript(full)))
        else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes('/generated/')) files.push(full)
    }
    return files
}

function cleanMessage(value) {
    return value
        .replace(/\$\{[^}]*\}/g, ' ')
        .replace(/\\[nrt]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function isUserFacingLatin(value) {
    if (!/[A-Za-z]/.test(value) || value.length < 2) return false
    if (/^(?:https?:|data:|\/|#|\.|[A-Za-z]:\\)/.test(value)) return false
    if (/^[a-z0-9_./:@-]+$/i.test(value)) {
        return /^(?:Loading|Cancel|Close|Delete|Edit|Save|Retry|Continue|Back|Next|Done|Error|Success)$/i.test(value)
    }
    return true
}

function callName(expression) {
    if (ts.isIdentifier(expression)) return expression.text
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text
    return ''
}

function isInsideSkippedElement(node, sourceFile) {
    let current = node.parent
    while (current) {
        if (ts.isJsxElement(current)) {
            const tag = current.openingElement.tagName.getText(sourceFile).toLowerCase()
            if (['script', 'style', 'textarea'].includes(tag)) return true
        }
        current = current.parent
    }
    return false
}

function addExpressionMessages(node, add) {
    if (!node) return
    if (ts.isStringLiteralLike(node)) {
        add(node.text)
        return
    }
    if (ts.isTemplateExpression(node)) {
        add(node.head.text)
        for (const span of node.templateSpans) {
            addExpressionMessages(span.expression, add)
            add(span.literal.text)
        }
        return
    }
    if (ts.isConditionalExpression(node)) {
        addExpressionMessages(node.whenTrue, add)
        addExpressionMessages(node.whenFalse, add)
        return
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        addExpressionMessages(node.left, add)
        addExpressionMessages(node.right, add)
        return
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
        addExpressionMessages(node.right, add)
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
        addExpressionMessages(node.expression, add)
    }
}

// Only model inputs and logging expressions are excluded. Server errors and
// status labels still reach the UI, so never drop a whole service/API module.
function internalMessageNodes(sourceFile, file) {
    const internal = new Set()
    const visible = new Set()
    const host = ts.createCompilerHost({ noLib: true, noResolve: true })
    host.getSourceFile = name => (path.resolve(name) === path.resolve(file) ? sourceFile : undefined)
    const program = ts.createProgram([file], { noLib: true, noResolve: true }, host)
    const checker = program.getTypeChecker()
    const serverSource = /(?:^|\/)src\/(?:services|lib|app\/api)\//.test(file.replaceAll('\\', '/'))
    const mark = (node, followReferences = false, seen = new Set(), target = internal) => {
        if (!node || seen.has(node)) return
        seen.add(node)
        target.add(node)
        if (followReferences && ts.isIdentifier(node)) {
            const isPropertyName = (ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node
            if (!isPropertyName) {
                for (const declaration of checker.getSymbolAtLocation(node)?.declarations ?? []) {
                    if (declaration.getSourceFile() === sourceFile && ts.isVariableDeclaration(declaration)) mark(declaration.initializer, true, seen, target)
                }
            }
        }
        if (followReferences && ts.isCallExpression(node)) {
            for (const declaration of checker.getSymbolAtLocation(node.expression)?.declarations ?? []) {
                if (declaration.getSourceFile() !== sourceFile || !ts.isFunctionDeclaration(declaration) || !declaration.body) continue
                const visitReturn = child => {
                    if (ts.isReturnStatement(child)) mark(child.expression, true, seen, target)
                    else ts.forEachChild(child, visitReturn)
                }
                visitReturn(declaration.body)
            }
        }
        ts.forEachChild(node, child => mark(child, followReferences, seen, target))
    }
    const visit = node => {
        if (ts.isCallExpression(node)) {
            for (const index of translatedCalls.get(callName(node.expression)) ?? []) mark(node.arguments[index], true, new Set(), visible)
        }
        if (ts.isNewExpression(node) && ['Error', 'BillingError', 'StylePreviewPublishError'].includes(callName(node.expression))) mark(node.arguments?.[0], true, new Set(), visible)
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const receiver = node.expression.expression.getText(sourceFile)
            if (['console', 'logger', 'log'].includes(receiver) && ['log', 'info', 'warn', 'error', 'debug', 'trace'].includes(node.expression.name.text)) {
                for (const argument of node.arguments) mark(argument)
            }
        }
        if (serverSource && ts.isObjectLiteralExpression(node)) {
            const role = node.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'role')
            const modelMessage = role && ts.isStringLiteralLike(role.initializer) && ['system', 'user', 'assistant'].includes(role.initializer.text)
            for (const property of node.properties) {
                if (!ts.isPropertyAssignment(property)) continue
                const name = property.name.getText(sourceFile)
                if ((modelMessage && name === 'content') || ['prompt', 'systemPrompt', 'userPrompt', 'negativePrompt'].includes(name)) mark(property.initializer, true)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    for (const node of visible) internal.delete(node)
    return internal
}

export function extractMessages(file, text) {
    const found = new Set()
    const addHan = raw => {
        const value = cleanMessage(raw)
        if (/\p{Script=Han}/u.test(value) && value.length <= 600) found.add(value)
    }
    const addVisible = raw => {
        const value = cleanMessage(raw)
        if (value.length > 600) return
        if (/^&[a-z0-9#]+;$/i.test(value)) return
        if (/\p{Script=Han}/u.test(value) || isUserFacingLatin(value)) found.add(value)
    }

    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const internal = internalMessageNodes(sourceFile, file)
    const visit = node => {
        // Retain dynamic Chinese copy unless its source is a proven model input
        // or log. Explicit UI/error sinks below take precedence over exclusions.
        if (ts.isStringLiteralLike(node) && !internal.has(node)) addHan(node.text)
        if (ts.isTemplateExpression(node) && !internal.has(node)) {
            addHan(node.head.text)
            for (const span of node.templateSpans) addHan(span.literal.text)
        }

        if (ts.isJsxText(node) && !isInsideSkippedElement(node, sourceFile)) addVisible(node.text)
        if (ts.isJsxAttribute(node) && translatedAttributes.has(node.name.getText(sourceFile))) {
            if (node.initializer && ts.isStringLiteral(node.initializer)) addVisible(node.initializer.text)
            if (node.initializer && ts.isJsxExpression(node.initializer)) addExpressionMessages(node.initializer.expression, addVisible)
        }
        if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && !isInsideSkippedElement(node, sourceFile)) {
            addExpressionMessages(node.expression, addVisible)
        }
        if (ts.isPropertyAssignment(node) && translatedProperties.has(node.name.getText(sourceFile)) && (file.endsWith('.tsx') || node.name.getText(sourceFile) === 'message') && !internal.has(node)) {
            addExpressionMessages(node.initializer, addVisible)
        }
        if (ts.isCallExpression(node)) {
            const name = callName(node.expression)
            const indexes = translatedCalls.get(name)
            // Explicit translation keys include single English words such as
            // "Help"; those must not be mistaken for non-translatable identifiers.
            const add =
                name === 't' || name === 'translateMessage'
                    ? raw => {
                          const value = cleanMessage(raw)
                          if (value && value.length <= 600) found.add(value)
                      }
                    : addVisible
            for (const index of indexes ?? []) addExpressionMessages(node.arguments[index], add)
        }
        if (ts.isNewExpression(node) && ['Error', 'BillingError', 'StylePreviewPublishError'].includes(callName(node.expression))) {
            addExpressionMessages(node.arguments?.[0], addVisible)
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return found
}

function extractLocalizedObjectMessages(file, text, names) {
    const found = new Set()
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const collectStrings = node => {
        if (ts.isStringLiteralLike(node)) {
            const value = cleanMessage(node.text)
            if (value && value.length <= 600) found.add(value)
        }
        ts.forEachChild(node, collectStrings)
    }
    const visit = node => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text) && node.initializer) collectStrings(node.initializer)
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return found
}

export async function collectSourceMessages(root) {
    const files = (await Promise.all(sourceRoots.map(dir => walkTypeScript(path.join(root, dir))))).flat().filter(file => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) && !file.includes('/__tests__/'))
    files.push(...sourceFiles.map(file => path.join(root, file)))
    const messages = new Set(['选择语言', '热门', '超值'])
    for (const file of files) {
        const text = await fs.readFile(file, 'utf8')
        for (const phrase of extractMessages(file, text)) messages.add(phrase)
    }
    for (const { file, names } of localizedMessageObjects) {
        const absolute = path.join(root, file)
        const text = await fs.readFile(absolute, 'utf8')
        for (const phrase of extractLocalizedObjectMessages(absolute, text, names)) messages.add(phrase)
    }
    return messages
}
