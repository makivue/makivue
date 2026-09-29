import { describe, expect, it } from 'vitest'
import { buildImageReferenceRoleMap } from './reference-role-map'

describe('buildImageReferenceRoleMap', () => {
    it('maps roles to the exact 1-based provider order and merges duplicate image roles', () => {
        expect(
            buildImageReferenceRoleMap(['previous.png', 'style.png', 'alice.png'], [
                { url: 'alice.png', description: 'canonical identity for Alice' },
                { url: 'previous.png', description: 'previous ending frame' },
                { url: 'style.png', description: 'style only' },
                { url: 'alice.png', description: 'face and hair only' }
            ])
        ).toContain(
            [
                '- reference image #1: previous ending frame',
                '- reference image #2: style only',
                '- reference image #3: canonical identity for Alice; face and hair only'
            ].join('\n')
        )
    })

    it('omits references that were not actually sent and compacts line breaks', () => {
        const result = buildImageReferenceRoleMap(['scene.png'], [
            { url: 'missing.png', description: 'not sent' },
            { url: 'scene.png', description: 'exact scene\nlayout\tand palette' },
            { url: null, description: 'empty' }
        ])

        expect(result).toContain('- reference image #1: exact scene layout and palette')
        expect(result).not.toContain('not sent')
    })

    it('returns an empty string when no sent reference has a role', () => {
        expect(buildImageReferenceRoleMap(['frame.png'], [{ url: 'other.png', description: 'other' }])).toBe('')
    })
})
