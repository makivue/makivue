import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const excludedDirectories = new Set(['.git', 'node_modules', '.next', 'out', 'build', 'coverage', 'test-results', '.tmp', '.secrets', 'data', 'data.lock'])

function isRuntimeEnvFile(file) {
    const name = path.basename(file)
    return name.startsWith('.env') && name !== '.env.example' && name !== '.env.local.example'
}

function isExcludedDirectory(relativePath) {
    const normalized = relativePath.split(path.sep).join('/')
    return excludedDirectories.has(path.basename(relativePath)) || normalized === 'public/storage' || normalized.startsWith('public/storage/')
}

function listWorkspaceFiles(directory = '.', relativeDirectory = '') {
    const files = []
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relativePath = path.join(relativeDirectory, entry.name)
        if (entry.isDirectory()) {
            if (!isExcludedDirectory(relativePath)) {
                files.push(...listWorkspaceFiles(path.join(directory, entry.name), relativePath))
            }
            continue
        }
        if (entry.isFile() && !isRuntimeEnvFile(relativePath)) {
            files.push(relativePath)
        }
    }
    return files
}

let files
let usingGit = true
try {
    files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
} catch (error) {
    if (error?.code !== 'ENOENT') throw error
    usingGit = false
    files = listWorkspaceFiles()
    console.warn('Warning: git is unavailable; scanning workspace files with build/runtime directories excluded.')
}

const forbiddenFiles = [
    /^(?:[^/]*(?:credentials?|service-account|secret|key|payment)[^/]*)\.json$/i,
    /^\.secrets\//,
    /^\.env(?:$|\.(?!example$|local\.example$))/,
    /^(?:gpt5|happy_horse|nano_banana|seedance|hi-models)\.json$/
]
const secretPatterns = [
    { label: 'Aliyun AccessKey', pattern: /\bLTAI[0-9A-Za-z]{12,}\b/ },
    { label: 'API secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
    { label: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
    { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
    { label: 'JWT token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
    { label: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ }
]
// One-way fingerprints prevent removed literals from being reintroduced without
// embedding the values in this repository or printing them in scanner output.
const removedCredentialHashes = new Set(['a8bb2bb08de5802fdb53579a7e1c7945df4db38e65a951a08599aa613108cfaf', '1fe3696eaeb885367fff6bdd345a6874bef10b1ae12c9487ab60776c823448ef'])
// Digests identify removed private/project references without retaining their text.
// Split identifiers, path components and display names so renamed wrappers cannot
// accidentally reintroduce a removed service or identity.
const removedReferenceHashes = new Set([
    '10688a5b3f51925ae67b76734652a389d84ee26e57dad4c19d6cb56d2cf3cc0a',
    '6f621ffa99b53514a27944f8846404d01ff498ab59266ec75a5080e535633912',
    '5519666ff196d06a3b41e66a5807a7dea735cf7f45d62fcdd8a42c8ec10c3cc9',
    '8513a78b52fb8813ea875cafc80f1d8397f41383e17afbe318602508602670ca',
    '569bf0af7a7562f31bbe4795656b6bdf307f7752163abc139157e3a3033b43ff',
    '77062b16261bf5885fbd18dc57cbd1ea5ff9c9ee3fd6044759b9cc3eae3bb0f2',
    '7bc223abe471510a624da41370baad8fa22cc8479134550c51ad005f03ee2b22',
    '255067543631ab5fb44c60bdb8e94863ff11d923b5a6c50f7b5d1c1b61f17a2f',
    '7063d51d1b2da165eee042de5d33cc27281ea80e1a291488c903b7fb5fc31da7',
    '74694ad512b9867cc95e0dc7d1dba6b4375c7bb616b75f0f8066d37c4b719005',
    '5524b0d85802c96e25f7fce044238bfc15cba8bdf5f04c16cdaec0b544eaf8a1',
    'a11287d66bd545df10b14a2c832fcfdd36b59859b05d8b7669f3b934388181e9',
    '88b5b839f5347a57afc9c57c49db45db9d17042007124ac4518a75140daec9ff',
    '84442c031f69c7a584ef453247f1abd472c5b029645f50e39ecc07d8b44cd476',
    '34ceb3804b4d78fb3d318331a4f4f107ddab08dc21fba7a7deb0464ba13c2779',
    '618b8c8de24c7b03f7a150fa9419177f753a46bd123fdcbb4f11d643abf066eb',
    '65f98121a162a56ad8ee919ed9ea394b9eabd8714616acf30636c6092ee350b9',
    'd30865b78270f19a09d0e6e26423c0780de49a0c8cc0304c83833623d7b903b9',
    '761f5f76c4041be436288da36c98a687233f74452fa58ba4c0f9e9f4bf41dc5c'
])
function hasRemovedReference(content) {
    const candidates = new Set()
    for (const match of content.matchAll(/[A-Za-z][A-Za-z0-9_.-]*/g)) {
        const token = match[0]
        candidates.add(token.toLowerCase().replace(/[^a-z0-9]/g, ''))
        for (const part of token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_.-]+/)) {
            candidates.add(part.toLowerCase())
        }
    }
    for (const match of content.matchAll(/\b([A-Za-z]+)[ _-]+([A-Za-z]+)\b/g)) candidates.add((match[1] + match[2]).toLowerCase())
    for (const value of candidates) {
        if (value.length >= 5 && value.length <= 24 && removedReferenceHashes.has(createHash('sha256').update(value).digest('hex'))) return true
    }
    return false
}
const failures = new Set()
function inspect(file, content, label = file) {
    if (forbiddenFiles.some(pattern => pattern.test(file)) || /(?:^|\/)[^/]+\.(?:pem|key|p12|pfx)$/.test(file)) {
        failures.add(`${label}: credential/config file must not be tracked`)
    }
    if (hasRemovedReference(file + '\n' + content)) failures.add(`${label}: contains a removed project or service reference`)
    for (const { label: kind, pattern } of secretPatterns) {
        if (pattern.test(content)) failures.add(`${label}: contains ${kind}`)
    }
    for (const match of content.matchAll(/[A-Za-z0-9_+./=-]{16,}/g)) {
        if (removedCredentialHashes.has(createHash('sha256').update(match[0]).digest('hex'))) failures.add(`${label}: contains a removed hardcoded credential`)
    }
}
for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue
    inspect(file, fs.readFileSync(file, 'utf8'))
}

// Inspect staged bytes too: an unstaged cleanup must not hide a credential that
// is still about to be committed. No raw matches are included in diagnostics.
function inspectGitObjects(entries, scope) {
    if (!entries.length) return
    const output = execFileSync('git', ['cat-file', '--batch'], {
        input: entries.map(entry => entry.oid).join('\n') + '\n',
        maxBuffer: 512 * 1024 * 1024
    })
    let offset = 0
    for (const entry of entries) {
        const end = output.indexOf(10, offset)
        const [oid, type, size] = output.subarray(offset, end).toString().split(' ')
        offset = end + 1
        const length = Number(size)
        if (!Number.isSafeInteger(length)) throw new Error('Could not read Git object')
        if (type === 'blob' || type === 'commit' || type === 'tag') inspect(entry.file, output.subarray(offset, offset + length).toString('utf8'), `${scope}:${entry.file}@${oid.slice(0, 12)}`)
        offset += length + 1
    }
}
if (usingGit) {
    const staged = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .map(line => {
            const [metadata, file] = line.split('\t')
            return { oid: metadata.split(' ')[1], file }
        })
    inspectGitObjects(staged, 'index')
    if (process.argv.includes('--history')) {
        const historicalPaths = execFileSync('git', ['log', '--all', '--format=', '--name-only', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        for (const file of new Set(
            historicalPaths
                .split('\0')
                .map(value => value.trim())
                .filter(Boolean)
        ))
            inspect(file, '', `history-path:${file}`)
        const objects = execFileSync('git', ['rev-list', '--all', '--objects'], { encoding: 'utf8' })
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => ({ oid: line.slice(0, 40), file: line.slice(41) || '(metadata)' }))
        inspectGitObjects(objects, 'history')
        console.log(`History scan completed: ${objects.length} named Git objects`)
    }
}
if (failures.size) {
    console.error(`Committed secret check failed:\n${[...failures].join('\n')}`)
    process.exit(1)
}
console.log(usingGit ? `Committed secret check passed: ${files.length} publishable paths and staged content scanned` : `Secret check passed: ${files.length} workspace paths scanned (git unavailable)`)
