import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workspace = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/page.tsx'), 'utf8')
const characterRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/characters/[id]/route.ts'), 'utf8')
const sceneRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/scenes/[id]/route.ts'), 'utf8')
const expandRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/expand-prompt/route.ts'), 'utf8')

describe('reference prompt editor', () => {
    const characterPatch = characterRoute.slice(characterRoute.indexOf('export async function PATCH'), characterRoute.indexOf('export async function DELETE'))
    const scenePatch = sceneRoute.slice(sceneRoute.indexOf('export async function PATCH'), sceneRoute.indexOf('export async function DELETE'))

    it('keeps prompts out of cards and opens one shared accessible dialog', () => {
        expect(workspace).not.toContain('expandedCharacterPromptIds')
        expect(workspace).not.toContain('expandedScenePromptIds')
        expect(workspace).toContain('title="编辑角色 Prompt"')
        expect(workspace).toContain('title="编辑场景 Prompt"')
        expect(workspace).toContain('function ReferencePromptDialog')
        expect(workspace).toContain('role="dialog"')
        expect(workspace).toContain('aria-modal="true"')
    })

    it('saves explicitly without deleting existing reference images or generated media', () => {
        expect(workspace).toContain('onSave={savePromptEditor}')
        expect(workspace).toContain("method: 'PATCH'")
        expect(workspace).toContain('保存 Prompt 不会删除现有参考图或已生成视频；新的 Prompt 将用于之后重新生成的内容。')
        expect(workspace).not.toContain('保存并重置参考图')
        expect(characterPatch).not.toContain('referenceImageUrl: null')
        expect(characterPatch).not.toContain('markReferenceDependentsStaleInTransaction')
        expect(scenePatch).not.toContain('referenceImageUrl: null')
        expect(scenePatch).not.toContain('markReferenceDependentsStaleInTransaction')
    })

    it('offers guided AI optimization and expansion without auto-saving the returned draft', () => {
        expect(workspace).toContain("runAiAction('rewrite', {")
        expect(workspace).toContain("runAiAction('expand')")
        expect(workspace).toContain('PROMPT_OPTIMIZATION_ISSUES')
        expect(workspace).toContain('分析图片并优化')
        expect(workspace).toContain('应用到编辑框')
        expect(workspace).toContain("field: isCharacter ? 'characterPrompt' : 'scenePrompt'")
        expect(workspace).toContain('optimizationFeedback')
        expect(workspace).toContain('referenceTargetId: entity.id')
        expect(expandRoute).toContain("'characterPrompt', 'scenePrompt'")
        expect(expandRoute).toContain('SYSTEM_CHARACTER_PROMPT_EXPAND')
        expect(expandRoute).toContain('SYSTEM_SCENE_PROMPT_EXPAND')
        expect(expandRoute).toContain('inspectReferencePromptImage')
        expect(expandRoute).toContain('visualDiagnosisUsed')
    })

    it('keeps typing state inside the dialog instead of rerendering the project card grid', () => {
        expect(workspace).toContain('const [draft, setDraft] = useState(initialValue)')
        expect(workspace).toContain('setDraft(event.target.value)')
        expect(workspace).not.toContain('characterPromptDrafts')
        expect(workspace).not.toContain('scenePromptDrafts')
    })
})
