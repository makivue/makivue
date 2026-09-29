import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/projects/route'
import { GET as getProject, PATCH, DELETE } from '@/app/api/projects/[id]/route'
import { prisma } from '@/lib/prisma'
import { currentUserId } from '@/lib/current-user'
import { walletBillingEnabled, walletRechargeMode } from './billing'
let directory: string
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-workspace-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected remote call'))
})
afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
})
it('creates, reads, updates and deletes a project and its episodes through real local handlers', async () => {
    const create = await POST(new NextRequest('http://localhost/api/projects', { method: 'POST', body: JSON.stringify({ title: '本地项目', totalEpisodes: 2 }) }))
    expect(create.status).toBe(201)
    const { data: project } = await create.json()
    const params = { params: Promise.resolve({ id: project.id }) }
    const request = new NextRequest(`http://localhost/api/projects/${project.id}`)
    expect((await (await GET(new NextRequest('http://localhost/api/projects'))).json()).data).toHaveLength(1)
    const loaded = await (await getProject(request, params)).json()
    expect(loaded.data.episodes).toHaveLength(2)
    const patch = await PATCH(new NextRequest(request.url, { method: 'PATCH', body: JSON.stringify({ title: '修改后' }) }), params)
    expect(patch.status).toBe(200)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: BigInt(project.id) } })).title).toBe('修改后')
    expect((await DELETE(request, params)).status).toBe(200)
    expect((await (await GET(new NextRequest('http://localhost/api/projects'))).json()).data).toHaveLength(0)
    expect(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8')).toContain('修改后')
    expect(fetch).not.toHaveBeenCalled()
})
it('uses one local identity and cannot enable billing using legacy configuration', async () => {
    vi.stubEnv('WALLET_BILLING_ENABLED', 'true')
    vi.stubEnv('WALLET_PAYMENT_PROVIDER', 'external')
    expect(walletBillingEnabled()).toBe(false)
    expect(walletRechargeMode()).toBe('disabled')
    expect(currentUserId(new Request('http://localhost', { headers: { 'x-user-id': '987' } }))).toBe(1n)
    expect(fetch).not.toHaveBeenCalled()
})
