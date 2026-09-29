import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('AI creator reference video integration', () => {
    it('offers multi-video upload with the shared count and size limits', () => {
        const page = source('src/app/create/CreatorWorkspace.tsx')
        const uploadRoute = source('src/app/api/create/reference-videos/route.ts')

        expect(page).toContain('multiple')
        expect(page).toContain("t('个，每个不超过 300MB')")
        expect(uploadRoute).toContain('MAX_REFERENCE_VIDEO_BYTES')
        expect(uploadRoute).toContain('参考视频最大 300MB')
    })

    it('validates uploaded references and forwards them to every supported provider request', () => {
        const route = source('src/app/api/create/video/route.ts')

        expect(route).toContain('rawReferenceVideos.length > MAX_STORYBOARD_REFERENCE_VIDEOS')
        expect(route).toContain('isOSSObjectWithinSubdir')
        expect(route).toContain("type: 'reference_video'")
        expect(route).toContain("type: 'video_url'")
        expect(route).toContain('referenceVideos,')
    })
})
