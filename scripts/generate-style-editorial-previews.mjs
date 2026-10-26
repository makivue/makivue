#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { require as requireTs } from 'tsx/cjs/api'

const { VISUAL_STYLE_PRESETS } = requireTs('../src/lib/novel.ts', import.meta.url)
const { isEditorialStylePreview } = requireTs('../src/lib/style-preview.ts', import.meta.url)
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const root = path.resolve('public/style-previews')

for (const [index, style] of VISUAL_STYLE_PRESETS.filter(item => isEditorialStylePreview(item.key)).entries()) {
    const target = path.join(root, `${style.key}.webp`)
    // Authored/model artwork takes priority; replace placeholders explicitly when wanted.
    if (await fs.stat(target).catch(() => null)) continue
    const hue = (index * 37 + 195) % 360
    const title = Array.from(style.label)
    const titleLines = title.length > 6 ? [title.slice(0, 6).join(''), title.slice(6).join('')] : [style.label]
    const lines = titleLines.map((line, row) => `<text x="32" y="${496 + row * 45}" font-size="34" font-weight="600">${escape(line)}</text>`).join('')
    const hint = style.hint.split('、')
    const hintLines = hint.map((line, row) => `<text x="33" y="${588 + row * 22}" font-size="13" fill="#d1d5db">${escape(line)}</text>`).join('')
    const bars = Array.from({ length: 16 }, (_, bar) => `<path d="M ${48 + bar * 20} ${135 + Math.sin(bar * 0.6 + index) * 28} v ${140 + Math.cos(bar * 0.4 + index) * 70}" stroke="hsl(${hue},65%,76%)" stroke-opacity="${0.18 + bar / 32}" stroke-width="${style.key === 'pixel-art' ? 14 : 2}"/>`).join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700" viewBox="0 0 400 700">
        <defs><linearGradient id="bg" x2="0.8" y2="1"><stop stop-color="hsl(${hue},45%,18%)"/><stop offset="1" stop-color="#0d111b"/></linearGradient><radialGradient id="glow"><stop stop-color="hsl(${hue},70%,65%)" stop-opacity=".35"/><stop offset="1" stop-color="hsl(${hue},70%,65%)" stop-opacity="0"/></radialGradient></defs>
        <rect width="400" height="700" fill="url(#bg)"/>
        <circle cx="245" cy="220" r="230" fill="url(#glow)"/>
        <g fill="none" stroke="hsl(${hue},65%,76%)" stroke-opacity=".24"><circle cx="200" cy="225" r="126"/><circle cx="200" cy="225" r="96"/><path d="M32 225h336M200 62v326"/><rect x="30" y="30" width="340" height="640" rx="5" stroke-opacity=".2"/></g>
        ${bars}
        <g font-family="PingFang SC,Noto Sans CJK SC,Arial,sans-serif" fill="#f5f7fb">
            <text x="33" y="69" font-size="11" letter-spacing="3" fill="hsl(${hue},65%,76%)">ART DIRECTION</text>
            <text x="33" y="422" font-size="12" letter-spacing="3" fill="hsl(${hue},65%,76%)">风格概念</text>
            ${lines}${hintLines}
            <text x="33" y="647" font-size="10" fill="#8b93a5">${escape(style.key.toUpperCase())}</text>
        </g>
    </svg>`
    await fs.mkdir(root, { recursive: true })
    await sharp(Buffer.from(svg)).webp({ quality: 90 }).toFile(target)
    for (const width of [256, 384]) {
        const directory = path.join(root, 'thumbs', String(width))
        await fs.mkdir(directory, { recursive: true })
        await sharp(target).resize({ width }).webp({ quality: 85 }).toFile(path.join(directory, `${style.key}.webp`))
    }
}
