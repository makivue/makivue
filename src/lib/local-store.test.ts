import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocalFileClient } from './local-store'

let directory: string
const original = process.env.LOCAL_DATA_DIR
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-local-store-'))
    process.env.LOCAL_DATA_DIR = directory
})
afterEach(async () => {
    if (original === undefined) delete process.env.LOCAL_DATA_DIR
    else process.env.LOCAL_DATA_DIR = original
    await fs.rm(directory, { recursive: true, force: true })
})
describe('local JSON workspace', () => {
    it('persists types, defaults and relationships across client restarts', async () => {
        const client = createLocalFileClient()
        const project = await client.project.create({ data: { id: 1234567890123456789n, title: 'Local project', trailerDuration: '12.5', contentFacts: { story: ['one'] } } })
        expect(project.visibility).toBe('private')
        expect(project.createdAt).toBeInstanceOf(Date)
        await client.episode.create({ data: { id: 2n, projectId: project.id, episodeNumber: 1, title: 'Opening' } })
        const restarted = createLocalFileClient()
        const loaded = await restarted.project.findUniqueOrThrow({ where: { id: project.id }, include: { episodes: true, _count: { select: { episodes: true } } } })
        expect(loaded.id).toBe(project.id)
        expect(loaded.trailerDuration?.toString()).toBe('12.5')
        expect(loaded.contentFacts).toEqual({ story: ['one'] })
        expect(loaded.episodes[0].title).toBe('Opening')
        expect(loaded._count.episodes).toBe(1)
        expect(await restarted.episode.findMany({ where: { project: { title: { contains: 'Local' } } }, select: { id: true } })).toEqual([{ id: 2n }])
    })
    it('serializes concurrent changes and rolls back callback and array transactions', async () => {
        const client = createLocalFileClient()
        await client.project.create({ data: { id: 1n, title: 'Counter' } })
        await Promise.all(Array.from({ length: 12 }, () => client.project.update({ where: { id: 1n }, data: { operationVersion: { increment: 1 } } })))
        expect((await client.project.findUniqueOrThrow({ where: { id: 1n } })).operationVersion).toBe(12)
        await expect(
            client.$transaction(async tx => {
                await tx.project.update({ where: { id: 1n }, data: { title: 'Lost' } })
                throw new Error('rollback')
            })
        ).rejects.toThrow('rollback')
        await expect(
            client.$transaction([client.project.update({ where: { id: 1n }, data: { title: 'Also lost' } }), client.project.create({ data: { id: 1n, title: 'Duplicate' } })])
        ).rejects.toMatchObject({ code: 'P2002' })
        expect((await client.project.findUniqueOrThrow({ where: { id: 1n } })).title).toBe('Counter')
        const results = await client.$transaction([client.project.update({ where: { id: 1n }, data: { title: 'Saved' } }), client.project.findUnique({ where: { id: 1n } })])
        expect(results[1]?.title).toBe('Saved')
    })
    it('supports filters, pagination and soft deletion without changing other projects', async () => {
        const client = createLocalFileClient()
        await client.project.createMany({ data: [1, 2, 3, 4].map(id => ({ id: BigInt(id), title: `Project ${id}` })) })
        await client.project.update({ where: { id: 4n }, data: { deletedAt: new Date() } })
        const selected = await client.project.findMany({ where: { deletedAt: null, OR: [{ id: { gte: 2n } }, { title: 'missing' }] }, orderBy: { id: 'desc' }, take: 1, skip: 1 })
        expect(selected.map(row => row.id)).toEqual([2n])
        await client.project.deleteMany({ where: { id: { in: [2n, 3n] } } })
        expect(await client.project.count()).toBe(2)
    })
    it('refuses corrupt data without overwriting it or leaking the lock', async () => {
        const filename = path.join(directory, 'workspace.json')
        await fs.writeFile(filename, '{broken')
        const client = createLocalFileClient()
        await expect(client.project.create({ data: { id: 1n, title: 'Lost' } })).rejects.toThrow('本地项目文件无法读取')
        expect(await fs.readFile(filename, 'utf8')).toBe('{broken')
        await fs.writeFile(filename, '{"version":1,"collections":{}}')
        expect((await client.project.create({ data: { id: 1n, title: 'Recovered' } })).title).toBe('Recovered')
    })
})
