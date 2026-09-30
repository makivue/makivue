import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workspace = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
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
        expect(workspace).toContain('保存后，需要重新生成相关图片才能应用修改。')
        expect(workspace).not.toContain('保存并重置参考图')
        expect(characterPatch).not.toContain('referenceImageUrl: null')
        expect(characterPatch).not.toContain('markReferenceDependentsStaleInTransaction')
        expect(scenePatch).not.toContain('referenceImageUrl: null')
        expect(scenePatch).not.toContain('markReferenceDependentsStaleInTransaction')
    })
    it('keeps reference prompts manually editable without AI optimization', () => {
        expect(workspace).not.toContain('runAiAction')
        expect(workspace).not.toContain('PROMPT_OPTIMIZATION_ISSUES')
        expect(expandRoute).not.toContain('inspectReferencePromptImage')
    })

    it('keeps typing state inside the dialog instead of rerendering the project card grid', () => {
        expect(workspace).toContain('const [draft, setDraft] = useState(initialValue)')
        expect(workspace).toContain('setDraft(event.target.value)')
        expect(workspace).not.toContain('characterPromptDrafts')
        expect(workspace).not.toContain('scenePromptDrafts')
    })
})
