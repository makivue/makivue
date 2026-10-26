import 'server-only'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { feedbackFileFormat, feedbackFileIssue, type FeedbackAttachment } from '@/lib/site-feedback'
import { saveLocalMediaFile, deleteLocalMediaWithinSubdirectory, localMediaMatchesSubdirectory } from './local-media'
import type { Prisma } from '@/generated/prisma/client'

export class FeedbackFileValidationError extends Error {}

export async function readFeedbackReceipt(receipt: unknown, userId: bigint): Promise<FeedbackAttachment> {
    if (typeof receipt !== 'string' || !/^[a-f0-9-]{36}$/.test(receipt)) throw new Error('附件凭证无效，请重新上传。')
    const row = await prisma.localFeedbackUpload.findUnique({ where: { id: receipt } })
    if (!row || row.userId !== userId || row.expiresAt.getTime() <= Date.now()) throw new Error('附件凭证无效，请重新上传。')
    const attachment = row.attachment as unknown as FeedbackAttachment
    if (!attachment || !localMediaMatchesSubdirectory(attachment.url, `feedback/${userId}`)) throw new Error('附件凭证无效，请重新上传。')
    return attachment
}

export async function uploadFeedbackFile(file: File, bytes: Buffer, userId: bigint) {
    const issue = feedbackFileIssue(file)
    if (issue || bytes.length !== file.size) throw new FeedbackFileValidationError(issue || '附件大小无效。')
    const format = feedbackFileFormat(file)!
    if (format.kind === 'image') {
        const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata().catch(() => null)
        const expected = format.extension === 'jpg' ? 'jpeg' : format.extension
        if (!metadata?.width || !metadata.height || metadata.format !== expected) throw new FeedbackFileValidationError('附件实际内容与文件格式不一致。')
    } else {
        const matches = format.extension === 'webm' ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
        if (!matches) throw new FeedbackFileValidationError('附件实际内容与文件格式不一致。')
    }
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'makivue-feedback-'))
    const filename = `${randomUUID()}.${format.extension}`
    const subdir = `feedback/${userId}`
    let url: string | undefined
    try {
        const filePath = path.join(temporary, filename)
        await fs.writeFile(filePath, bytes, { mode: 0o600 })
        url = await saveLocalMediaFile(filePath, subdir, filename)
        const attachment: FeedbackAttachment = { url, name: file.name.slice(0, 255), kind: format.kind, mimeType: format.mimeType, size: file.size }
        const receipt = randomUUID()
        await prisma.localFeedbackUpload.create({ data: { id: receipt, userId, attachment: attachment as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } })
        return { attachment, receipt }
    } catch (error) {
        if (url) await deleteLocalMediaWithinSubdirectory(url, subdir).catch(() => {})
        throw error
    } finally {
        await fs.rm(temporary, { recursive: true, force: true })
    }
}
