import { afterEach, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prisma } from './prisma'
import { tryAcquireProviderQuota, renewProviderQuota, releaseProviderQuota } from './provider-quota-store'
let directory: string
const original = process.env.LOCAL_DATA_DIR
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-quota-'))
    process.env.LOCAL_DATA_DIR = directory
})
afterEach(async () => {
    if (original === undefined) delete process.env.LOCAL_DATA_DIR
    else process.env.LOCAL_DATA_DIR = original
    await fs.rm(directory, { recursive: true, force: true })
})
it('serializes supplier admission, reserves all scopes atomically and expires abandoned leases', async () => {
    const budget = { key: 'test:local-model', concurrency: 1, requestsPerMinute: 60000, tokensPerMinute: 10000, tokens: 100 }
    const attempts = await Promise.all([tryAcquireProviderQuota([budget]), tryAcquireProviderQuota([budget])])
    expect(attempts.filter(result => result.ids.length)).toHaveLength(1)
    const ids = attempts.find(result => result.ids.length)!.ids
    expect(await renewProviderQuota(ids)).toBe(true)
    const blocked = await tryAcquireProviderQuota([{ ...budget, key: 'other' }, budget])
    expect(blocked.ids).toEqual([])
    expect(await prisma.providerQuotaLease.count({ where: { scopeKey: 'other' } })).toBe(0)
    await prisma.providerQuotaLease.updateMany({ where: { id: { in: ids } }, data: { expiresAtMs: BigInt(Date.now() - 1) } })
    expect(await renewProviderQuota(ids)).toBe(false)
    expect((await tryAcquireProviderQuota([budget])).ids).toHaveLength(1)
    await releaseProviderQuota(ids)
})
