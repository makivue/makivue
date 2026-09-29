import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { issueSessionToken } from '@/lib/session-token'
import { POST } from './route'

const originalSessionSecret = process.env.APP_SESSION_SECRET

describe('project import fast parse route', () => {
    beforeEach(() => {
        process.env.APP_SESSION_SECRET = 'project-import-route-test-secret'
    })

    afterEach(() => {
        if (originalSessionSecret === undefined) delete process.env.APP_SESSION_SECRET
        else process.env.APP_SESSION_SECRET = originalSessionSecret
    })

    it('returns a synchronous JSON preview without creating a background job', async () => {
        const token = issueSessionToken({ userId: 7n, email: 'import-test@example.com' })
        const response = await POST(
            new NextRequest('http://localhost/api/projects/import', {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    filename: 'quick-test.docx',
                    text: Buffer.from(
                        '56ysMembhiDlvIDnq68KCjEtMSDml6Ug5YaFIOWuouagiAoK55S76Z2iMe+8iOWFqOaZr++8jOW5s+inhu+8iQrkuLvop5LotbDov5vlrqLmoIjjgIIK5peB55m977ya5pWF5LqL5byA5aeL44CC',
                        'base64'
                    ).toString('utf8')
                })
            })
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/json')
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            data: {
                importId: expect.any(String),
                mode: 'fast',
                result: { stage: 'storyboard', totalEpisodes: 1, totalStoryboards: 1 }
            }
        })
    })
})
