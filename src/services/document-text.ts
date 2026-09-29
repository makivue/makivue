import { Worker } from 'node:worker_threads'

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown'])
const DOCX_EXTENSIONS = new Set(['docx'])
const PDF_EXTENSIONS = new Set(['pdf'])
const MAX_ZIP_ENTRIES = 2_000
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024
const MAX_ZIP_RATIO = 100
const MAX_PDF_PAGES = 300
const MAX_EXTRACTED_TEXT = 200_000
const PARSE_TIMEOUT_MS = 15_000

const SUPPORTED_SCRIPT_DOCUMENT_EXTENSIONS = [...TEXT_EXTENSIONS, ...DOCX_EXTENSIONS, ...PDF_EXTENSIONS]

function fileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() ?? ''
}

function normalizeExtractedText(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/^--\s*\d+\s+of\s+\d+\s*--$/gim, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim()
}

function decodePlainText(buffer: Buffer): string {
    const utf8 = new TextDecoder('utf-8').decode(buffer)
    const replacementCount = (utf8.match(/�/g) ?? []).length
    if (replacementCount === 0) return utf8
    try {
        const gb18030 = new TextDecoder('gb18030').decode(buffer)
        return (gb18030.match(/�/g) ?? []).length < replacementCount ? gb18030 : utf8
    } catch {
        return utf8
    }
}

function findZipEocd(buffer: Buffer) {
    const start = Math.max(0, buffer.length - 65_557)
    for (let offset = buffer.length - 22; offset >= start; offset--) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
    }
    return -1
}

function validateDocxArchive(buffer: Buffer) {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('DOCX 文件签名无效')
    const eocd = findZipEocd(buffer)
    if (eocd < 0) throw new Error('DOCX 压缩目录损坏')
    const entryCount = buffer.readUInt16LE(eocd + 10)
    const directorySize = buffer.readUInt32LE(eocd + 12)
    let offset = buffer.readUInt32LE(eocd + 16)
    if (entryCount > MAX_ZIP_ENTRIES) throw new Error(`DOCX 内部文件过多（最多 ${MAX_ZIP_ENTRIES} 个）`)
    if (offset + directorySize > buffer.length) throw new Error('DOCX 压缩目录越界')
    let totalUncompressed = 0
    let hasContentTypes = false
    for (let index = 0; index < entryCount; index++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('DOCX 压缩目录条目损坏')
        const flags = buffer.readUInt16LE(offset + 8)
        const compressed = buffer.readUInt32LE(offset + 20)
        const uncompressed = buffer.readUInt32LE(offset + 24)
        const nameLength = buffer.readUInt16LE(offset + 28)
        const extraLength = buffer.readUInt16LE(offset + 30)
        const commentLength = buffer.readUInt16LE(offset + 32)
        if (flags & 0x1) throw new Error('不支持加密 DOCX')
        if (uncompressed > MAX_ZIP_ENTRY_BYTES) throw new Error('DOCX 单个内部文件解压后过大')
        if (compressed > 0 && uncompressed / compressed > MAX_ZIP_RATIO) throw new Error('DOCX 压缩比异常，疑似解压炸弹')
        totalUncompressed += uncompressed
        if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error('DOCX 解压后内容超过 50MB')
        const nameStart = offset + 46
        const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8')
        if (name === '[Content_Types].xml') hasContentTypes = true
        offset = nameStart + nameLength + extraLength + commentLength
    }
    if (!hasContentTypes) throw new Error('文件不是有效的 DOCX')
}

function validatePdf(buffer: Buffer) {
    const prefix = buffer
        .subarray(0, Math.min(buffer.length, 1024))
        .toString('latin1')
        .replace(/^\uFEFF?\s*/, '')
    if (!prefix.startsWith('%PDF-')) throw new Error('PDF 文件签名无效')
}

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const bytes = Buffer.from(workerData.buffer);
  let text = '';
  let pages = 0;
  if (workerData.kind === 'docx') {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default || mammothModule;
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const result = await parser.getText();
      text = result.text;
      pages = result.total;
    } finally {
      await parser.destroy();
    }
  }
  parentPort.postMessage({ text, pages });
})().catch(error => parentPort.postMessage({ error: error && error.message ? error.message : String(error) }));
`

async function parseInWorker(kind: 'docx' | 'pdf', buffer: Buffer): Promise<{ text: string; pages: number }> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_SOURCE, {
            eval: true,
            workerData: { kind, buffer },
            resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }
        })
        const timer = setTimeout(() => {
            void worker.terminate()
            reject(new Error(`文档解析超过 ${PARSE_TIMEOUT_MS / 1000} 秒，已停止处理`))
        }, PARSE_TIMEOUT_MS)
        worker.once('message', (result: { text?: string; pages?: number; error?: string }) => {
            clearTimeout(timer)
            void worker.terminate()
            if (result.error) reject(new Error(`文档解析失败：${result.error}`))
            else resolve({ text: result.text ?? '', pages: result.pages ?? 0 })
        })
        worker.once('error', error => {
            clearTimeout(timer)
            reject(new Error(`文档解析进程异常：${error.message}`))
        })
    })
}

export async function extractScriptDocumentText(filename: string, buffer: Buffer): Promise<string> {
    const extension = fileExtension(filename)
    let text = ''
    if (TEXT_EXTENSIONS.has(extension)) {
        text = decodePlainText(buffer)
    } else if (DOCX_EXTENSIONS.has(extension)) {
        validateDocxArchive(buffer)
        text = (await parseInWorker('docx', buffer)).text
    } else if (PDF_EXTENSIONS.has(extension)) {
        validatePdf(buffer)
        const result = await parseInWorker('pdf', buffer)
        if (result.pages > MAX_PDF_PAGES) throw new Error(`PDF 页数超过 ${MAX_PDF_PAGES} 页，请拆分后再导入`)
        text = result.text
    } else {
        throw new Error(`暂不支持 .${extension || '未知'} 文件，请上传 ${SUPPORTED_SCRIPT_DOCUMENT_EXTENSIONS.map(item => `.${item}`).join('、')}`)
    }
    const normalized = normalizeExtractedText(text)
    if (normalized.length > MAX_EXTRACTED_TEXT) throw new Error('文档内容超过 20 万字，请拆分后再导入')
    if (!normalized) throw new Error(PDF_EXTENSIONS.has(extension) ? '未能从 PDF 中提取文字；扫描版 PDF 请先进行 OCR' : '文档中没有可导入的文字')
    return normalized
}
