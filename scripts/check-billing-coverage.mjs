import fs from 'node:fs/promises'
import path from 'node:path'
import { walkTypeScript } from './i18n-source-messages.mjs'

const root = process.cwd()
const apiRoot = path.join(root, 'src/app/api')
const files = (await walkTypeScript(apiRoot)).filter(file => file.endsWith('/route.ts'))
const generationFunctions = [
    'generateChapter',
    'generateEpisodeScript',
    'generateNovel',
    'generateNovelSetup',
    'generateOutlineBatch',
    'generatePersonalStoryDirections',
    'generateStoryboards',
    'extractCharactersAndScenesBatched',
    'generateCharacterReference',
    'generateSceneReference',
    'generateProjectStyleReference',
    'generateFrame',
    'generateVideo',
    'composeShot',
    'mergeEpisodeVideos',
    'splitComplexActionStoryboard'
]

const failures = []
let covered = 0

const billingService = await fs.readFile(path.join(root, 'src/services/billing.ts'), 'utf8')
const reservationService = await fs.readFile(path.join(root, 'src/services/wallet-reservations.ts'), 'utf8')
const prismaSchema = await fs.readFile(path.join(root, 'prisma/schema.prisma'), 'utf8')
const walletUiFiles = ['src/components/WalletBalance.tsx', 'src/app/profile/page.tsx', 'src/app/wallet/page.tsx']

if (!/const amountPoints = roundUpUsagePoints\(params\.amountPoints\)/.test(billingService)) {
    failures.push('src/services/billing.ts: chargeWalletUsage must round the complete debit up to whole coins')
}
if (!/new Prisma\.Decimal\(points\)\.ceil\(\)/.test(reservationService)) {
    failures.push('src/services/wallet-reservations.ts: reservations must round up to whole coins')
}
if ((prismaSchema.match(/@db\.Decimal\(18, 0\)/g) ?? []).length !== 6) {
    failures.push('prisma/schema.prisma: all six wallet point columns must use Decimal(18, 0)')
}
for (const relative of walletUiFiles) {
    const text = await fs.readFile(path.join(root, relative), 'utf8')
    if (/maximumFractionDigits:\s*[1-9]/.test(text)) failures.push(`${relative}: wallet coins must not display fractional digits`)
}

for (const file of files) {
    const relative = path.relative(root, file)
    if (relative.startsWith('src/app/api/admin/')) continue
    const text = await fs.readFile(file, 'utf8')
    const usesGeneration = generationFunctions.some(name => new RegExp(`\\b${name}\\s*\\(`).test(text))
    if (!usesGeneration) continue
    const importsBilling = /from ['"]@\/services\/billing['"]/.test(text)
    const preflights = /\bassertSufficientPoints\s*\(/.test(text)
    const chargesDirectly = /\bcharge(?:LlmUsage|WalletUsage|ModelUsage|GenerationUsage)\s*\(/.test(text)
    const reconcilesGeneratedRecords = /\breconcile(?:EpisodeProduction|GenerationTelemetry)\s*\(/.test(text)
    if (!importsBilling || !preflights || (!chargesDirectly && !reconcilesGeneratedRecords)) {
        failures.push(`${relative}: billingImport=${importsBilling}, preflight=${preflights}, settlement=${chargesDirectly || reconcilesGeneratedRecords}`)
    } else {
        covered += 1
    }
}

const creatorFlows = [
    {
        name: 'AI Creator image',
        preflightFile: 'src/app/api/create/image/route.ts',
        settlementFile: 'src/app/api/create/image/route.ts'
    },
    {
        name: 'AI Creator video',
        preflightFile: 'src/app/api/create/video/route.ts',
        settlementFile: 'src/app/api/create/video/status/route.ts'
    },
    {
        name: 'Kling comparison video',
        preflightFile: 'src/app/api/storyboards/[id]/compare-kling/route.ts',
        settlementFile: 'src/services/kling-comparison.ts'
    }
]
for (const flow of creatorFlows) {
    const preflightText = await fs.readFile(path.join(root, flow.preflightFile), 'utf8')
    const settlementText = flow.settlementFile === flow.preflightFile ? preflightText : await fs.readFile(path.join(root, flow.settlementFile), 'utf8')
    const importsBilling = [preflightText, settlementText].every(text => /from ['"]@\/services\/billing['"]/.test(text))
    const preflights = /\bassertSufficientPoints\s*\(/.test(preflightText)
    const settlesPoints = /\bcharge(?:WalletUsage|ModelUsage|GenerationUsage)\s*\(/.test(settlementText)
    if (!importsBilling || !preflights || !settlesPoints) {
        failures.push(`${flow.name}: billingImport=${importsBilling}, preflight=${preflights}, pointSettlement=${settlesPoints}`)
    } else {
        covered += 1
    }
}

if (failures.length) {
    console.error(`billing coverage check failed\n${failures.join('\n')}`)
    process.exit(1)
}
console.log(`billing coverage check passed: ${covered} user generation routes settle whole-point usage`)
