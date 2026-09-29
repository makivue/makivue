#!/usr/bin/env node

import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { GoogleAuth } from 'google-auth-library'
import { require as requireTs } from 'tsx/cjs/api'
import { assertExternalDirectory, createStylePreviewPublisher, option } from './style-preview-publish-client.mjs'
const { localStylePreviewCatalog, STYLE_PREVIEW_ASSET_VERSION } = requireTs('./style-preview-catalog.ts', import.meta.url)
const { validateStylePreviewPublication } = requireTs('../src/lib/style-preview-publishing.ts', import.meta.url)

dotenv.config({ path: '.env', quiet: true })

const OUT_DIR = assertExternalDirectory(option('out-dir') || path.join(os.tmpdir(), `style-previews-${randomUUID()}`))
const VERSION = option('version') || STYLE_PREVIEW_ASSET_VERSION
const DRY_RUN = process.argv.includes('--dry-run')
const PROMPTS_FILE = option('prompts-file')
const MODEL = process.env.NANO_BANANA_MODEL || 'gemini-3.1-flash-image'
const ASPECT_RATIO = '9:16'
const IMAGE_SIZE = option('image-size') || '4K'
if (!['1K', '2K', '4K'].includes(IMAGE_SIZE)) throw new Error('--image-size must be 1K, 2K or 4K')
const FORCE = process.argv.includes('--force')
const ONLY_KEYS = new Set(
    (option('only') ?? '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
)
const RETRIES = 3
const failed = []
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json')
let manifest = {}
try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
} catch {}

const PROMPT_OVERRIDES = {
    'korean-clean':
        'clean romantic drama style preview, fictional adult protagonist in bright refined modern interior, soft daylight, polished fashion styling, gentle pastel color grading, elegant emotional close-up, premium short drama poster, no text, no logo',
    'q-version':
        'cute super-deformed animation style preview, toy-like stylized adult drama mascots with rounded proportions in a cozy colorful scene, bright cheerful colors, playful expression, premium vertical short drama poster, no text, no logo'
}

const NON_HUMAN_STYLE_KEYS = new Set([
    'african-wildlife',
    'rainforest-wildlife',
    'ocean-wildlife',
    'arctic-wildlife',
    'prehistoric-animals',
    'insect-micro-world',
    'bird-migration',
    'animal-family-doc',
    'savanna-animal-kingdom',
    'nostalgic-chinese-animal-cartoon',
    'animal-city-comedy',
    'forest-animal-adventure',
    'ocean-animal-animation',
    'dinosaur-family-animation',
    'pet-adventure',
    'savanna-wildlife-doc',
    'big-cat-kingdom',
    'primate-tribe',
    'wolf-pack',
    'horse-epic',
    'madagascar-wildlife',
    'serengeti-migration'
])

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function readServiceAccountJson() {
    if (process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON)
    if (process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON_B64) return JSON.parse(Buffer.from(process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8'))

    const candidates = [process.env.NANO_BANANA_CREDENTIALS_PATH, process.env.GOOGLE_APPLICATION_CREDENTIALS].filter(Boolean)
    const saPath = candidates.find(candidate => fs.existsSync(candidate))
    if (!saPath) {
        throw new Error('Nano Banana credentials not found. Set NANO_BANANA_SERVICE_ACCOUNT_JSON_B64 or NANO_BANANA_SERVICE_ACCOUNT_JSON.')
    }
    return JSON.parse(fs.readFileSync(saPath, 'utf-8'))
}

async function getAccessToken() {
    const sa = readServiceAccountJson()
    const auth = new GoogleAuth({
        credentials: sa,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
    const client = await auth.getClient()
    const tokenRes = await client.getAccessToken()
    if (!tokenRes.token) throw new Error('Failed to acquire Google access token')
    return { token: tokenRes.token, projectId: sa.project_id }
}

async function loadStylePrompts() {
    // Allows new, locally reviewed presets to be rendered before deployment;
    // local development intentionally proxies every API to the test service.
    if (PROMPTS_FILE) {
        const styles = JSON.parse(fs.readFileSync(path.resolve(PROMPTS_FILE), 'utf8'))
        if (!Array.isArray(styles) || !styles.length || styles.some(style => !/^[a-z0-9-]+$/.test(style.key) || typeof style.label !== 'string' || !style.previewPrompt?.trim())) {
            throw new Error('Prompt file must contain an array of { key, label, previewPrompt } presets')
        }
        const local = new Map(localStylePreviewCatalog().map(style => [style.key, style]))
        return styles.map(style => ({ ...style, directory: style.directory || local.get(style.key)?.directory || 'standard' }))
    }
    return localStylePreviewCatalog()
}

function sourcePath(style) {
    return path.join(OUT_DIR, style.directory === 'regional-generated' ? 'regional-generated' : '', `${style.key}.png`)
}

async function generateOne(style, auth) {
    const url = `https://aiplatform.googleapis.com/v1/projects/${auth.projectId}/locations/global/publishers/google/models/${MODEL}:generateContent`
    const baseStylePrompt = PROMPT_OVERRIDES[style.key] ?? style.previewPrompt
    const compositionPrompt = NON_HUMAN_STYLE_KEYS.has(style.key)
        ? `Make this a sharp vertical visual sample for the style card "${style.label}", one polished wildlife or animal-led scene with no humans anywhere, species-accurate anatomy, distinctive environment, premium nature-documentary or animated-animal composition as specified, clear lighting, high-detail textures, absolutely no written words, no title, no watermark, no logo, no UI, 9:16 vertical frame.`
        : `Make this a sharp vertical visual sample for the style card "${style.label}", one polished fictional scene, distinctive art direction, fictional adult drama protagonist when the concept calls for a person, premium short-drama poster composition, crisp focal details, clear lighting, high-detail textures, absolutely no written words, no title, no watermark, no logo, no UI, 9:16 vertical frame.`
    const prompt = `${baseStylePrompt}
${compositionPrompt}
Make the image look high-resolution and production-ready: tack-sharp focal subject, clean edges, readable material texture, no haze, no accidental blur, no compression artifacts.`
        .replace(/\byoung\b/gi, 'adult')
        .replace(/\bteen\b/gi, 'adult')
        .replace(/\bteenage\b/gi, 'adult')
        .replace(/\bkid\b/gi, 'adult')
        .replace(/\bchild\b/gi, 'adult')

    const body = {
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }]
            }
        ],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: ASPECT_RATIO, imageSize: IMAGE_SIZE }
        },
        safetySettings: [
            {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'BLOCK_ONLY_HIGH'
            },
            {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_ONLY_HIGH'
            },
            {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'BLOCK_ONLY_HIGH'
            },
            {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'BLOCK_ONLY_HIGH'
            }
        ]
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000)
    })
    if (!res.ok) throw new Error(`${style.key} failed: ${res.status} ${await res.text()}`)

    const data = await res.json()
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find(part => part.inlineData?.data)
    if (!imagePart) {
        const text = parts
            .map(part => part.text)
            .filter(Boolean)
            .join(' ')
            .slice(0, 400)
        throw new Error(`${style.key} returned no image${text ? `: ${text}` : ''}`)
    }

    const outPath = sourcePath(style)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, Buffer.from(imagePart.inlineData.data, 'base64'))
    console.log(`Wrote ${outPath}`)
    return {
        key: style.key,
        presetVersion: style.presetVersion,
        finalPreviewPrompt: prompt,
        model: MODEL,
        aspectRatio: ASPECT_RATIO,
        imageSize: IMAGE_SIZE,
        generatedAt: new Date().toISOString()
    }
}

async function generateWithRetry(style, auth) {
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
        try {
            return await generateOne(style, auth)
        } catch (error) {
            if (attempt === RETRIES) throw error
            const waitMs = attempt * 8000
            console.warn(`${style.key} attempt ${attempt} failed, retrying in ${waitMs / 1000}s: ${error.message}`)
            await sleep(waitMs)
        }
    }
}

const styles = (await loadStylePrompts()).filter(style => !ONLY_KEYS.size || ONLY_KEYS.has(style.key))
if (!styles.length) throw new Error('No style keys matched')
for (const key of ONLY_KEYS) if (!styles.some(style => style.key === key)) throw new Error(`Unknown local style key: ${key}`)
for (const style of styles) validateStylePreviewPublication({ ...style, version: VERSION })
const publisher = DRY_RUN ? null : createStylePreviewPublisher()
// Fail before paid generation when the production endpoint is not deployed or login expired.
if (publisher) await publisher.preflight()
let auth

for (const style of styles) {
    if (DRY_RUN) {
        console.log(`${style.key} (${style.directory}): generate -> production API -> ${VERSION} original + 256px + 384px`)
        continue
    }
    const outPath = sourcePath(style)
    if (!FORCE && manifest[style.key]?.publication?.version === VERSION && !fs.existsSync(outPath)) {
        console.log(`Already published ${style.key} in ${VERSION}`)
        continue
    }
    try {
        if (FORCE || !fs.existsSync(outPath)) {
            auth ??= await getAccessToken()
            const metadata = await generateWithRetry(style, auth)
            if (metadata) manifest[style.key] = metadata
        }
        // A failed upload can resume from its existing source without generating (or billing) again.
        const result = await publisher.publish({ key: style.key, version: VERSION, directory: style.directory }, fs.readFileSync(outPath), 'image/png')
        manifest[style.key] = { ...manifest[style.key], publication: result }
        fs.unlinkSync(outPath)
        console.log(`Published and verified ${result.original.url}; removed temporary source`)
    } catch (error) {
        failed.push({ key: style.key, message: error.message })
        console.error(`Failed ${style.key}: ${error.message}`)
    }
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
    await sleep(1500)
}

if (failed.length) {
    console.error('\nFailed styles:')
    for (const item of failed) console.error(`- ${item.key}: ${item.message}`)
    console.error(`Sources retained in ${OUT_DIR}. Resume with --out-dir ${OUT_DIR} --only ${failed.map(item => item.key).join(',')} --version ${VERSION}`)
    process.exitCode = 1
} else if (!DRY_RUN && !option('out-dir')) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
}
