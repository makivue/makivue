import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCreatorSessions } from '@/app/create/creator-session'

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('default generation providers', () => {
    it('uses Nano Banana by default across image generation entry points', () => {
        const episodePage = source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')
        const projectPage = source('src/app/projects/[id]/page.tsx')
        const singleRoute = source('src/services/storyboard-generation-handler.ts')
        const batchRoute = source('src/app/api/episodes/[id]/generate-all/route.ts')
        const imageService = source('src/services/ai.ts')

        expect(episodePage).toContain("useState<ImageProvider>('banana')")
        expect(episodePage).toContain("defaultImageProvider ?? 'banana'")
        expect(projectPage).toContain("useState<ImageProvider>('banana')")
        expect(singleRoute).toContain("const imageTaskProvider = imageProviderOpt ?? 'banana'")
        expect(batchRoute).toContain("return 'banana'")
        expect(imageService).toContain("return 'banana' // 默认 nano-banana")
    })

    it('uses Wan 3.0 by default across video generation entry points', () => {
        const episodePage = source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')
        const replicaPage = source('src/app/replica/page.tsx')
        const singleRoute = source('src/services/storyboard-generation-handler.ts')
        const batchRoute = source('src/app/api/episodes/[id]/generate-all/route.ts')
        const videoService = source('src/services/ai.ts')
        const capabilities = source('src/lib/provider-capabilities.ts')

        expect(capabilities).toContain("DEFAULT_VIDEO_PROVIDER = 'wan3'")
        expect(episodePage).toContain('useState<ProductionVideoProvider>(DEFAULT_VIDEO_PROVIDER)')
        expect(episodePage).toContain('defaultVideoProvider ?? DEFAULT_VIDEO_PROVIDER')
        expect(episodePage).toContain('provider: provider ?? DEFAULT_VIDEO_PROVIDER')
        expect(createCreatorSessions().video.videoModel).toBe('wan3')
        expect(replicaPage).toContain('useState<ReplicaVideoProvider>(DEFAULT_VIDEO_PROVIDER)')
        expect(singleRoute).toContain('videoProvider ?? DEFAULT_VIDEO_PROVIDER')
        expect(batchRoute).toContain(': DEFAULT_VIDEO_PROVIDER')
        expect(videoService).toContain('return DEFAULT_VIDEO_PROVIDER')
    })

    it('opens the standalone creation studio in a video-first layout', () => {
        const createPage = source('src/app/create/page.tsx')

        expect(createPage).toContain('localizePath(`/aivideo${suffix}`, locale)')
        expect(createCreatorSessions().video.ratios).toEqual(['16:9'])
    })
})
