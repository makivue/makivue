import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('creator asset deletion confirmation', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/create/CreatorWorkspace.tsx'), 'utf8')

    it('uses the in-app danger dialog instead of the browser confirm', () => {
        expect(page).toContain('useConfirmDialog()')
        expect(page).toContain("confirmText: t('永久删除')")
        expect(page).toContain("tone: 'danger'")
        expect(page).toContain('{confirmDialog}')
        expect(page).not.toContain('window.confirm')
    })

    it('keeps the destructive request behind the confirmation result', () => {
        expect(page).toContain('if (approved) await deleteAssets([asset])')
        expect(page).toContain('if (approved) await deleteAssets(selectedAssets)')
    })
})
