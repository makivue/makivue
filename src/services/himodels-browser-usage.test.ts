import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Himodels browser usage diagnostics', () => {
    it('returns provider usage through creator APIs and relies on the shared browser logger', () => {
        const createPage = source('src/app/create/CreatorWorkspace.tsx')
        const imageRoute = source('src/app/api/create/image/route.ts')
        const videoStatusRoute = source('src/app/api/create/video/status/route.ts')
        const clientFetch = source('src/lib/client-fetch.ts')
        expect(imageRoute).toContain('usage: generation.usage')
        expect(videoStatusRoute).toContain('extractHiModelsUsage(data)')
        expect(clientFetch).toContain('logHiModelsDiagnosticEvent(')
        expect(source('src/lib/himodels-browser-diagnostics.ts')).toContain('tokenUsageReturned: usage !== null')
        expect(createPage).not.toContain('logHiModelsUsage')
        expect(createPage).not.toContain('接口响应未返回 token usage')
    })

    it('returns completed storyboard usage for the shared browser logger', () => {
        const episodeRoute = source('src/app/api/episodes/[id]/route.ts')
        const episodePage = source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')
        expect(episodeRoute).toContain('latestHimodelsUsage: latestHimodelsGeneration')
        expect(episodePage).not.toContain('himodelsUsageLogIds')
        expect(episodePage).not.toContain('extractApiTokenUsage')
        expect(episodePage).not.toContain('token usage')
        expect(episodePage).not.toContain('接口响应未返回 token usage')
    })
})
