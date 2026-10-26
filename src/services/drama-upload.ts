import 'server-only'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import lockfile from 'proper-lockfile'
import sharp from 'sharp'
import { genId } from '@/lib/id'
import { localDataDirectory } from '@/lib/local-paths'
import {
    DRAMA_PART_BYTES,
    DRAMA_MIN_PART_BYTES,
    DRAMA_MAX_PART_BYTES,
    DRAMA_MAX_UPLOAD_PARTS,
    DRAMA_UPLOAD_PROTOCOL,
    dramaAssetFormat,
    validateDramaFile,
    validateDramaSubtitle,
    type DramaAssetKind
} from '@/lib/drama-upload'
import { localMediaFilePath, localMediaMatchesSubdirectory, saveLocalMediaFile } from './local-media'

export class DramaUploadError extends Error {
    constructor(
        message: string,
        public status = 400
    ) {
        super(message)
    }
}

type Ticket = { id: string; userId: string; kind: DramaAssetKind; name: string; size: number; uploadId: string; expiresAt: number; protocol?: typeof DRAMA_UPLOAD_PROTOCOL }
type Receipt = Ticket & { phase: 'saved'; url: string; duration: number }
type Part = { number: number; etag: string; size?: number }
const run = promisify(execFile)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function assertDirectory(directory: string) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new DramaUploadError('上传目录无效', 503)
}

export async function createDramaUploadStore(userId: bigint) {
    const workspace = localDataDirectory()
    await assertDirectory(workspace)
    const keyPath = path.join(workspace, '.drama-upload-key')
    try {
        await fs.writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if ((await fs.lstat(keyPath)).isSymbolicLink()) throw new DramaUploadError('上传目录无效', 503)
    const secret = await fs.readFile(keyPath)
    if (secret.length !== 32) throw new DramaUploadError('上传凭证服务暂时不可用', 503)
    const scope = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
    const root = path.join(os.tmpdir(), `makivue-drama-uploads-${scope}`)
    await assertDirectory(root)
    for (const entry of await fs.readdir(root)) {
        if (!/^[a-f0-9-]{36}$/.test(entry)) continue
        const candidate = path.join(root, entry)
        const stat = await fs.lstat(candidate)
        if (stat.isDirectory() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > 8 * 24 * 60 * 60_000) await fs.rm(candidate, { recursive: true, force: true })
    }
    const subdir = `drama-uploads/${userId}`
    const mac = (body: string) => createHmac('sha256', secret).update(`drama-upload:${body}`).digest('base64url')
    const sessionPath = (ticket: Ticket) => path.join(root, ticket.uploadId)
    function sign(value: Ticket | Receipt) {
        const body = Buffer.from(JSON.stringify(value)).toString('base64url')
        return `${body}.${mac(body)}`
    }
    function read(token: string): Ticket | Receipt {
        if (token.length > 4096) throw new DramaUploadError('上传内容无效')
        const [body, signature, extra] = token.split('.')
        const actual = Buffer.from(signature ?? '')
        const expected = Buffer.from(mac(body ?? ''))
        if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DramaUploadError('上传凭证无效或已过期，请重新上传', 403)
        let value: Ticket | Receipt
        try {
            value = JSON.parse(Buffer.from(body, 'base64url').toString())
        } catch {
            throw new DramaUploadError('上传内容无效')
        }
        if (!value || value.userId !== String(userId) || !/^\d+$/.test(value.id) || !/^[a-f0-9-]{36}$/.test(value.uploadId) || value.expiresAt <= Date.now() || validateDramaFile(value.kind, value))
            throw new DramaUploadError('上传凭证无效或已过期，请重新上传', 403)
        return value
    }
    async function locked<T>(ticket: Ticket, action: (directory: string) => Promise<T>) {
        const directory = sessionPath(ticket)
        try {
            if (!(await fs.lstat(directory)).isDirectory() || (await fs.lstat(directory)).isSymbolicLink()) throw new Error('Invalid staging path')
        } catch {
            throw new DramaUploadError('上传凭证无效或已过期，请重新上传', 403)
        }
        const release = await lockfile.lock(directory, { retries: { retries: 20, minTimeout: 25, maxTimeout: 250 }, stale: 60_000 })
        try {
            return await action(directory)
        } finally {
            await release()
        }
    }
    return {
        readTicket(token: string) {
            const value = read(token)
            if ('phase' in value) throw new DramaUploadError('上传内容无效')
            return value
        },
        readReceipt(token: unknown, kind: DramaAssetKind) {
            if (typeof token !== 'string') throw new DramaUploadError('上传内容无效')
            const value = read(token)
            if (!('phase' in value) || value.phase !== 'saved' || value.kind !== kind || !Number.isFinite(value.duration) || value.duration < 0 || !localMediaMatchesSubdirectory(value.url, subdir))
                throw new DramaUploadError('上传内容无效')
            return value
        },
        async begin(kind: DramaAssetKind, name: string, size: number, protocol?: typeof DRAMA_UPLOAD_PROTOCOL) {
            const issue = validateDramaFile(kind, { name, size })
            if (issue) throw new DramaUploadError(issue)
            const ticket: Ticket = { id: String(genId()), userId: String(userId), kind, name, size, uploadId: randomUUID(), expiresAt: Date.now() + 24 * 60 * 60_000, protocol }
            await fs.mkdir(sessionPath(ticket), { mode: 0o700 })
            return { token: sign(ticket), partSize: DRAMA_PART_BYTES, protocol }
        },
        async part(ticket: Ticket, number: number, bytes: Buffer) {
            const adaptive = ticket.protocol === DRAMA_UPLOAD_PROTOCOL
            const expected = Math.min(DRAMA_PART_BYTES, ticket.size - (number - 1) * DRAMA_PART_BYTES)
            if (
                !Number.isSafeInteger(number) ||
                number < 1 ||
                number > Math.ceil(ticket.size / (adaptive ? DRAMA_MIN_PART_BYTES : DRAMA_PART_BYTES)) ||
                (adaptive ? bytes.length <= 0 || bytes.length > Math.min(DRAMA_MAX_PART_BYTES, ticket.size) : expected <= 0 || bytes.length !== expected) ||
                (ticket.kind === 'subtitle' && (number !== 1 || bytes.length !== ticket.size))
            )
                throw new DramaUploadError('上传内容无效')
            if (ticket.kind === 'video' && number === 1) {
                const webm = ticket.name.toLowerCase().endsWith('.webm')
                const valid = webm ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
                if (!valid) throw new DramaUploadError('视频实际内容与文件格式不一致', 422)
            }
            if (ticket.kind === 'subtitle') {
                const issue = validateDramaSubtitle(ticket.name, bytes)
                if (issue) throw new DramaUploadError(issue, 422)
            }
            return locked(ticket, async directory => {
                let staged = bytes.length
                for (const entry of await fs.readdir(directory)) {
                    if (!/^\d+\.part$/.test(entry) || entry === `${number}.part`) continue
                    const stat = await fs.lstat(path.join(directory, entry))
                    if (!stat.isFile() || stat.isSymbolicLink()) throw new DramaUploadError('上传内容无效')
                    staged += stat.size
                }
                if (staged > ticket.size) throw new DramaUploadError('上传内容无效', 413)
                const temporary = path.join(directory, `${number}-${randomUUID()}.tmp`)
                try {
                    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
                    await fs.rename(temporary, path.join(directory, `${number}.part`))
                } finally {
                    await fs.rm(temporary, { force: true })
                }
                return { number, etag: hash(bytes), size: bytes.length }
            })
        },
        async complete(ticket: Ticket, parts: Part[]) {
            const adaptive = ticket.protocol === DRAMA_UPLOAD_PROTOCOL
            if (
                !parts.length ||
                parts.length > DRAMA_MAX_UPLOAD_PARTS ||
                (!adaptive && parts.length !== Math.ceil(ticket.size / DRAMA_PART_BYTES)) ||
                parts.some(
                    (part, index) =>
                        !part ||
                        part.number !== index + 1 ||
                        typeof part.etag !== 'string' ||
                        !/^[a-f0-9]{64}$/.test(part.etag) ||
                        (adaptive && (!Number.isSafeInteger(part.size) || part.size! < (index === parts.length - 1 ? 1 : DRAMA_MIN_PART_BYTES) || part.size! > DRAMA_MAX_PART_BYTES))
                ) ||
                (adaptive && parts.reduce((total, part) => total + part.size!, 0) !== ticket.size)
            )
                throw new DramaUploadError('上传内容无效')
            return locked(ticket, async directory => {
                const completed = path.join(directory, 'completed.json')
                try {
                    const result = JSON.parse(await fs.readFile(completed, 'utf8')) as { receipt: string; url: string; name: string; size: number }
                    this.readReceipt(result.receipt, ticket.kind)
                    await fs.access(await localMediaFilePath(result.url))
                    return result
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
                }
                const format = dramaAssetFormat(ticket.kind, ticket.name)!
                const assembled = path.join(directory, `assembled-${randomUUID()}.${format.extension}`)
                const output = await fs.open(assembled, 'wx', 0o600)
                let size = 0
                try {
                    for (const part of parts) {
                        const source = path.join(directory, `${part.number}.part`)
                        if ((await fs.lstat(source)).isSymbolicLink()) throw new DramaUploadError('上传内容无效')
                        const bytes = await fs.readFile(source)
                        if (hash(bytes) !== part.etag || (adaptive && bytes.length !== part.size)) throw new DramaUploadError('上传内容无效')
                        size += bytes.length
                        if (size > ticket.size) throw new DramaUploadError('上传内容无效')
                        await output.writeFile(bytes)
                    }
                } finally {
                    await output.close()
                }
                if (size !== ticket.size) throw new DramaUploadError('上传内容无效', 422)
                let duration = 0
                try {
                    if (ticket.kind === 'video') {
                        const { stdout } = await run(
                            process.env.FFPROBE_PATH || process.env.FFPROBE_BIN || 'ffprobe',
                            ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', assembled],
                            { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
                        )
                        const media = JSON.parse(stdout)
                        duration = Number(media.format?.duration)
                        if (!media.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'video') || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video')
                    } else if (ticket.kind === 'cover' || ticket.kind === 'portrait') {
                        const image = await sharp(assembled, { limitInputPixels: 40_000_000 }).metadata()
                        if (!image.width || !image.height || image.format !== (format.extension === 'jpg' ? 'jpeg' : format.extension)) throw new Error('Invalid image')
                    }
                } catch {
                    throw new DramaUploadError('文件校验失败，请检查文件后重新上传', 422)
                }
                const url = await saveLocalMediaFile(assembled, subdir, `${ticket.id}.${format.extension}`)
                const receipt = sign({ ...ticket, phase: 'saved', url, duration, expiresAt: Date.now() + 7 * 24 * 60 * 60_000 })
                const result = { receipt, url, name: ticket.name, size: ticket.size }
                const temporary = path.join(directory, `completed-${randomUUID()}.tmp`)
                await fs.writeFile(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o600 })
                await fs.rename(temporary, completed)
                const staged = (await fs.readdir(directory)).filter(entry => /^(?:\d+\.part|assembled-[a-f0-9-]+\.[a-z]+)$/.test(entry))
                await Promise.all(staged.map(entry => fs.rm(path.join(directory, entry), { force: true })))
                return result
            })
        },
        async abort(ticket: Ticket) {
            await locked(ticket, async directory => {
                for (const entry of await fs.readdir(directory)) {
                    if (/^(?:\d+\.part|assembled-[a-f0-9-]+\.[a-z]+|.*\.tmp)$/.test(entry)) await fs.rm(path.join(directory, entry), { force: true })
                }
            })
        }
    }
}
