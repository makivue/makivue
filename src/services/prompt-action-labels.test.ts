import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('prompt action labels', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
    it('does not offer storyboard prompt rewriting', () => {
        expect(page).not.toContain('expandingField')
        expect(page).not.toContain('runAiAction')
    })

    it('provides the concise labels in every locale catalog', () => {
        for (const locale of ['zh', 'en', 'fr', 'ar', 'id', 'hi', 'fil', 'ja', 'ko']) {
            const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/i18n/catalogs/${locale}.json`), 'utf8'))
            expect(catalog['改写']).toBeTruthy()
            expect(catalog['扩写']).toBeTruthy()
        }
    })
})
