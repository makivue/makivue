import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('replica video provider selection', () => {
    it('offers both Seedance versions and both Wan 3.0 variants, with linked duration choices', () => {
        const page = source('src/app/replica/page.tsx')
        expect(page).toContain("type ReplicaVideoProvider = Extract<ProductionVideoProvider, 'seedance' | 'seedance25' | 'wan3' | 'wan3prime'>")
        expect(page).toContain('useState<ReplicaVideoProvider>(DEFAULT_VIDEO_PROVIDER)')
        expect(page).toContain("{ value: 'seedance', label: SEEDANCE_20_LABEL")
        expect(page).toContain("{ value: 'seedance25', label: SEEDANCE_25_LABEL")
        expect(page).toContain("{ value: 'wan3', label: 'Wan 3.0'")
        expect(page).toContain("{ value: 'wan3prime', label: WAN_3_PRIME_LABEL")
        expect(page).toContain('支持 4-30 秒逐秒选择')
        expect(page).toContain('getVideoProviderCapability(videoProvider)?.duration.values')
        expect(page).toContain('videoDuration: Number(videoDuration)')
    })

    it('validates and normalizes the selected provider duration before forwarding', () => {
        const route = source('src/app/api/replica/jobs/route.ts')
        expect(route).toContain("requestedProvider === 'seedance25'")
        expect(route).toContain("requestedProvider === 'wan3'")
        expect(route).toContain("requestedProvider === 'wan3prime'")
        expect(route).toContain('normalizeVideoDuration(videoProvider, Number(body.videoDuration))')
    })
})
