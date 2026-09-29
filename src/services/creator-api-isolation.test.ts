import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('AI Creator API isolation', () => {
    const page = source('src/app/create/CreatorWorkspace.tsx')
    const imageRoute = source('src/app/api/create/image/route.ts')
    const videoRoute = source('src/app/api/create/video/route.ts')
    const videoStatusRoute = source('src/app/api/create/video/status/route.ts')
    const billing = source('src/services/billing.ts')

    it('uses creator-only image and video endpoints', () => {
        expect(page).toContain("clientFetch('/api/create/image'")
        expect(page).toContain("clientFetch('/api/create/video'")
        expect(imageRoute).toContain("createCreatorGenerationJob(userId, 'image')")
        expect(videoRoute).toContain("createCreatorGenerationJob(userId, 'video')")
        expect(imageRoute).not.toContain("@/lib/generation-concurrency")
        expect(videoRoute).not.toContain("@/lib/generation-concurrency")
    })

    it('holds a creator video slot until the provider result is saved', () => {
        expect(videoRoute).not.toContain("phase: 'done'")
        expect(videoStatusRoute).toContain("await updateJob(jobId, { phase: 'done'")
        expect(videoStatusRoute).toContain("await updateJob(jobId, {})")
    })

    it('checks funds and charges successful generations', () => {
        expect(billing).toContain('export function walletBillingEnabled(): boolean')
        expect(billing).toContain('if (!walletBillingEnabled()) return')
        expect(billing).toContain('balancePoints: { gte: amountPoints }')
        expect(billing).toContain('积分不足，生成费用未能扣除')
    })
})
