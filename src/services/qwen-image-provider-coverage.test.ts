import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('Qwen-Image 3.0 Pro provider coverage', () => {
    it.each([
        'src/app/create/CreatorWorkspace.tsx',
        'src/app/settings/page.tsx',
        'src/app/projects/[id]/page.tsx',
        'src/app/projects/[id]/episodes/[episodeId]/page.tsx'
    ])('is selectable in %s', file => {
        expect(source(file)).toContain('qwen-image-3.0-pro')
    })

    it.each([
        'src/app/api/create/image/route.ts',
        'src/app/api/characters/[id]/reference/route.ts',
        'src/app/api/scenes/[id]/reference/route.ts',
        'src/app/api/projects/[id]/style-reference/route.ts',
        'src/app/api/storyboards/[id]/middle-frames/[frameId]/route.ts',
        'src/services/storyboard-generation-handler.ts',
        'src/app/api/episodes/[id]/generate-all/route.ts'
    ])('accepts the shared image provider set in %s', file => {
        expect(source(file)).toContain('isImageProvider')
    })
})
