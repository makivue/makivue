import { describe, expect, it } from 'vitest'
import { resolveEpisodeTargetDimensions } from './ffmpeg'

describe('episode merge target dimensions', () => {
    it('uses project ratio and the modal available resolution', () => {
        expect(
            resolveEpisodeTargetDimensions(
                [
                    { width: 720, height: 1280 },
                    { width: 720, height: 1280 },
                    { width: 1080, height: 1920 }
                ],
                '9:16'
            )
        ).toEqual({ width: 720, height: 1280 })
    })

    it('uses the highest available resolution when there is no mode', () => {
        expect(resolveEpisodeTargetDimensions([{ width: 720, height: 1280 }, { width: 1080, height: 1920 }], '16:9')).toEqual({ width: 1920, height: 1080 })
    })
})
