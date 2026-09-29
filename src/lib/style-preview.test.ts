import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VISUAL_STYLE_PRESETS } from './novel'
import { getStylePreviewSrc } from './style-preview'

afterEach(() => vi.unstubAllEnvs())

describe('bundled style images', () => {
    it('has a decodable local original and both thumbnails for every preset', async () => {
        vi.stubEnv('NEXT_PUBLIC_STYLE_PREVIEW_BASE_URL', 'https://obsolete-storage.example')
        const keys = new Set(VISUAL_STYLE_PRESETS.map(style => style.key))
        expect(keys.size).toBe(VISUAL_STYLE_PRESETS.length)
        for (const key of keys) {
            for (const width of [undefined, 256, 384] as const) {
                const url = getStylePreviewSrc(key, width)
                expect(url).toMatch(/^\/style-previews\/(?:thumbs\/(?:256|384)\/)?[a-z0-9-]+\.webp$/)
                const bytes = await fs.readFile(path.join(process.cwd(), 'public', url))
                const metadata = await sharp(bytes).metadata()
                expect(metadata.format).toBe('webp')
                expect(metadata.width).toBeGreaterThan(0)
                if (width) expect(metadata.width).toBe(width)
            }
        }
    })
})
