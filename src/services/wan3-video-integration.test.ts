import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Wan 3.0 video integration', () => {
    it('maps the standard and Prime providers to their exact DashScope models', () => {
        const service = source('src/services/ai.ts')
        expect(service).toContain("const endpointPath = '/api/v1/services/aigc/video-generation/video-synthesis'")
        expect(service).toContain("const model = provider === 'wan3prime' ? WAN_3_PRIME_MODEL : WAN_3_MODEL")
        expect(service).toContain("provider: 'wan3' | 'wan3prime'")
        expect(service).toContain('resolution: WAN_3_RESOLUTION')
        expect(service).toContain('generateVideoWan3')
        const capabilities = source('src/lib/provider-capabilities.ts')
        expect(capabilities).toContain("WAN_3_MODEL = 'wan3.0-video'")
        expect(capabilities).toContain("WAN_3_PRIME_MODEL = 'wan3.0-video-prime'")
    })

    it('makes Wan 3.0 available in each local video-generation entry point', () => {
        expect(source('src/app/create/CreatorWorkspace.tsx')).toContain("{ value: 'wan3', label: 'Wan 3.0'")
        expect(source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')).toContain("{ value: 'wan3', label: 'Wan 3.0'")
        expect(source('src/app/replica/page.tsx')).toContain("{ value: 'wan3', label: 'Wan 3.0'")
        expect(source('src/app/create/CreatorWorkspace.tsx')).toContain("{ value: 'wan3prime', label: WAN_3_PRIME_LABEL")
        expect(source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')).toContain("{ value: 'wan3prime', label: WAN_3_PRIME_LABEL")
        expect(source('src/app/replica/page.tsx')).toContain("{ value: 'wan3prime', label: WAN_3_PRIME_LABEL")
        const creatorRoute = source('src/app/api/create/video/route.ts')
        expect(creatorRoute).toContain("model: provider === 'wan3prime' ? WAN_3_PRIME_MODEL : WAN_3_MODEL")
        expect(creatorRoute).toContain('resolution: WAN_3_RESOLUTION')
        expect(source('src/app/api/create/video/status/route.ts')).toContain("provider === 'wanx' || provider === 'wan3' || provider === 'wan3prime'")
    })
})
