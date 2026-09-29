import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public work detail layout', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/works/[id]/WorkDetail.tsx'), 'utf8')

    it('places the player and episode selector above the work information', () => {
        const playerIndex = source.indexOf('className="works-watch"')
        const selectorIndex = source.indexOf('className="works-episodes"')
        const informationIndex = source.indexOf('className="works-detail-hero"')

        expect(playerIndex).toBeGreaterThan(-1)
        expect(selectorIndex).toBeGreaterThan(playerIndex)
        expect(informationIndex).toBeGreaterThan(selectorIndex)
    })
})
