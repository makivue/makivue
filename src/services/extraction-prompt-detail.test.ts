import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('character and scene extraction prompt detail', () => {
    const llm = fs.readFileSync(path.join(process.cwd(), 'src/services/llm.ts'), 'utf8')

    it('asks for production-ready character identity detail', () => {
        expect(llm).toContain('70-120 个英文单词左右的完整描述')
        expect(llm).toContain('稳定服装层次、主辅色与材质、磨损程度')
        expect(llm).toContain('1-3 个独特识别点')
    })

    it('asks for reusable scene topology and continuity anchors', () => {
        expect(llm).toContain('90-160 个英文单词左右的完整描述')
        expect(llm).toContain('空间拓扑、前中后景、入口/出口与动线')
        expect(llm).toContain('至少 3 个稳定空间锚点及其相对关系')
    })
})
