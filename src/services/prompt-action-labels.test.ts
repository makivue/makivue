import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('prompt action labels', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')

    it('uses distinct rewrite and expand icons with concise labels', () => {
        expect(page).not.toContain("'一键改写'")
        expect(page).not.toContain("'一键扩写'")
        expect(page).toContain("<RefreshCw className={`w-3 h-3 ${expandingField === 'actionDescRewrite'")
        expect(page).toContain("<Sparkles className={`w-3 h-3 ${expandingField === 'actionDescExpand'")
        expect(page).toContain("? '改写中...' : '改写'")
        expect(page).toContain("? '扩写中...' : '扩写'")
    })

    it('provides the concise labels in every locale catalog', () => {
        for (const locale of ['zh', 'en', 'fr', 'ar', 'id', 'hi', 'fil', 'ja', 'ko']) {
            const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/i18n/catalogs/${locale}.json`), 'utf8'))
            expect(catalog['改写']).toBeTruthy()
            expect(catalog['扩写']).toBeTruthy()
        }
    })
})
