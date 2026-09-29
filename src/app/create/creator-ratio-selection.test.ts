import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('creator aspect-ratio selection', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/create/CreatorWorkspace.tsx'), 'utf8')

    it('renders ratios as a multi-select button grid', () => {
        expect(page).toContain("aria-label={t('选择画面比例（可多选）')}")
        expect(page).toContain('aria-pressed={selected}')
        expect(page).toContain('toggleRatio(option.value)')
        expect(page).not.toContain('ariaLabel="选择画面比例"')
    })

    it('creates and tracks one generation task per selected ratio', () => {
        expect(page).toContain('runWithConcurrency(selectedRatios')
        expect(page).toContain("form.append('ratio', selectedRatio)")
        expect(page).toContain('setGenerationProgress(current => ({ ...current, done: current.done + 1 }))')
        expect(page).toContain('setResultAssets(current => [asset')
    })
})
