import { describe, expect, it } from 'vitest'
import { extractScriptDocumentText } from './document-text'

describe('document import safety checks', () => {
    it('rejects extension spoofing before invoking a parser', async () => {
        await expect(extractScriptDocumentText('script.pdf', Buffer.from('not a pdf'))).rejects.toThrow('PDF 文件签名无效')
        await expect(extractScriptDocumentText('script.docx', Buffer.from('not a zip'))).rejects.toThrow('DOCX 文件签名无效')
    })

    it('continues to decode plain text documents', async () => {
        await expect(extractScriptDocumentText('script.txt', Buffer.from('第一场：雨夜。主角推门而入。'))).resolves.toContain('主角')
    })
})
