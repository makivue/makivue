import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('scene reference generation flow', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/ProjectWorkspace.tsx'), 'utf8')
    const ai = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/scenes/[id]/reference/route.ts'), 'utf8')
    const job = fs.readFileSync(path.join(process.cwd(), 'src/services/scene-reference-job.ts'), 'utf8')
    const batch = fs.readFileSync(path.join(process.cwd(), 'src/services/scene-reference-batch.ts'), 'utf8')
    const promptRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/expand-prompt/route.ts'), 'utf8')
    const scenePromptCompiler = fs.readFileSync(path.join(process.cwd(), 'src/lib/scene-reference-prompt.ts'), 'utf8')
    const progressPolicy = fs.readFileSync(path.join(process.cwd(), 'src/lib/reference-generation-progress.ts'), 'utf8')

    it('shows every successfully completed scene while a batch is still running', () => {
        const pollIndex = page.indexOf('async function followSceneReferenceBatch(')
        const localUpdateIndex = page.indexOf('setProject(previous =>', pollIndex)
        const finishIndex = page.indexOf('await fetchProject()', localUpdateIndex)
        expect(localUpdateIndex).toBeGreaterThan(pollIndex)
        expect(finishIndex).toBeGreaterThan(localUpdateIndex)
        expect(page).toContain('referenceImageUrl: result.referenceImageUrl ?? result.candidateUrl')
    })

    it('runs scene batches with a bounded server worker pool and consolidated polling', () => {
        expect(batch).toContain('runWithConcurrency(tasks, REFERENCE_BATCH_CONCURRENCY')
        expect(page).not.toContain('runWithConcurrency(scenesToGenerate, concurrency')
        expect(page).toContain('/scene-references/status/${jobId}')
        expect(progressPolicy).toContain('REFERENCE_BATCH_CONCURRENCY = 8')
        expect(ai).toContain("reportProgress('generating'")
        expect(ai).toContain("reportProgress('inspecting'")
        expect(ai).toContain("reportProgress('uploading'")
    })

    it('quotes the whole scene batch before asking the user to generate an affordable prefix', () => {
        expect(page).toContain('/scene-reference-quote`')
        expect(page).toContain('quote.affordableCount === 0')
        expect(page).toContain('scenesToGenerate = toGen.filter(scene => affordableSceneIds.has(scene.id))')
        expect(page).toContain('只够按页面顺序生成前 {affordable} 张')
        expect(page).toContain("confirmText: t('生成 {count} 张')")
    })

    it('keeps internal worker concurrency out of user-facing scene copy', () => {
        expect(page).not.toContain('sceneBatch.concurrency')
        expect(page).not.toContain('`批量生成场景候选（并发 ${REFERENCE_BATCH_CONCURRENCY}）`')
        expect(page).not.toContain('场景候选图（并发 ${concurrency}')
        expect(page).toContain("t('生成场景图')")
    })

    it('keeps scene prompts out of cards and opens them in the shared editor', () => {
        expect(page).not.toContain('expandedScenePromptIds')
        expect(page).not.toContain('aria-controls={`scene-prompt-${scene.id}`}')
        expect(page).toContain('onClick={() => openScenePromptEditor(scene)}')
        expect(page).toContain('title="编辑场景 Prompt"')
        expect(page).toContain('function ReferencePromptDialog')
    })

    it('shows scene descriptions on demand instead of permanently truncating them', () => {
        expect(page).toContain('const [expandedSceneDescriptionIds, setExpandedSceneDescriptionIds]')
        expect(page).toContain('aria-expanded={descriptionExpanded}')
        expect(page).toContain("descriptionExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'")
        expect(page).toContain('cursor-text select-text text-sm text-gray-400')
        expect(page).toContain("aria-label={descriptionExpanded ? t('收起') : t('展开')}")
    })

    it('shows more scene cards per row on wide screens', () => {
        expect(page).toContain('className="studio-reference-grid"')
        const styles = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
        expect(styles).toContain('repeat(auto-fill, minmax(min(100%, 280px), 1fr))')
        expect(styles).toContain('gap: 12px')
    })

    it('selects up to four scene views instead of replacing one primary image', () => {
        expect(page).not.toContain('已选视角 {selectedReferenceUrls.length}/{MAX_SELECTED_SCENE_REFERENCES}')
        expect(page).toContain("body: JSON.stringify({ action: selected ? 'unselect' : 'select', url })")
        expect(page).toContain("selected ? t('移出参考组')")
        expect(page).toContain('<CircleMinus className="h-4 w-4" />')
        expect(page).toContain('<CirclePlus className="h-4 w-4" />')
        expect(page).toContain('absolute bottom-1.5 right-1.5')
        expect(page).not.toContain('mt-1.5 flex w-full items-center justify-center gap-1.5')
        expect(page).toContain('pendingSceneReferenceSelections.current.has(key)')
        expect(page).toContain('selectedAfterRefresh === !selected')
        expect(page).toContain('网络连接中断，未能确认场景参考视角是否更新，请重试')
        expect(route).toContain('selectedReferenceUrls.length >= MAX_SELECTED_SCENE_REFERENCES')
        expect(route).toContain('createSceneReferenceSelection(nextSelectedReferenceUrls)')
    })

    it('navigates all candidates for one scene and changes the reference group from the preview', () => {
        expect(page).toContain("kind: 'scene'")
        expect(page).toContain('urls: candidates')
        expect(page).toContain('setSceneRefSelection(referencePreview.targetId, referencePreviewUrl, referencePreviewSelected)')
        expect(page).toContain('{referencePreview.index + 1} / {referencePreview.urls.length}')
    })

    it('keeps the image and remaining action at the same full card width', () => {
        expect(page).toContain('className="grid w-full gap-2"')
        expect(page).toContain('className="w-full min-w-0"')
        expect(page).toContain('className="relative aspect-video w-full"')
        expect(page).not.toContain('className="w-64 flex-shrink-0"')
    })

    it('feeds the selected scene views into storyboard frame generation within the provider budget', () => {
        expect(ai).toContain('const selectedSceneReferences = getSelectedSceneReferenceUrls(')
        expect(ai).toContain('for (const sceneReference of activeSceneReferences) pushBudgetedReference(sceneReference)')
        expect(ai).toContain('use the selected views together to reconstruct one coherent location')
    })

    it('shows a content-specific toast when a provider switches after three 429 responses', () => {
        expect(page).toContain('notifyImageProviderSwitch(progress.providerSwitch,')
        expect(page).toContain('次触发 429，已从')
        expect(page).toContain('pushToast(')
    })

    it('does not replay provider-switch toasts from restored batch snapshots', () => {
        expect(page).toContain('rememberImageProviderSwitch(item.progress?.providerSwitch ?? item.result?.providerSwitch, `character:${item.jobId}`)')
        expect(page).toContain('rememberImageProviderSwitch(item.progress?.providerSwitch ?? item.result?.providerSwitch, `scene:${item.jobId}`)')
    })

    it('reports the most frequent real failure instead of only a generic batch message', () => {
        expect(page).toContain('const failureCounts = new Map<string, number>()')
        expect(page).toContain('主要原因（${primaryFailure[1]} 个）')
        expect(page).toContain('生成失败：{sceneGenerationErrors[scene.id]}')
    })

    it('keeps the batch progress summary compact without per-scene detail rows', () => {
        expect(page).toContain('progress={sceneBatch}')
        expect(page).not.toContain('activeSceneIds')
        expect(page).not.toContain('sceneBatch.lastError')
    })

    it('does not treat a temporary polling fetch failure as a failed generated image', () => {
        expect(page).toContain('if (!isTransientReferenceJobError(message)) throw error')
        expect(page).toContain('lastPollingError = message')
        expect(page).toContain('if (sceneAlreadyHasImage) delete next[sceneId]')
    })

    it('uses an empty single-image lock and returns the first generated image without model inspection', () => {
        const sceneGeneration = ai.slice(ai.indexOf('export async function generateSceneReference'), ai.indexOf('// =================== 分镜视频生成'))
        expect(scenePromptCompiler).toContain('SCENE_SINGLE_IMAGE_LOCK')
        expect(ai).toContain('automaticFallback: true')
        expect(ai).toContain('const styleReferences = (setup.styleReferenceImages ?? []).filter(Boolean).slice(0, 1)')
        expect(sceneGeneration).toContain('maxAttempts: 1')
        expect(sceneGeneration).not.toContain('inspectSceneReferenceQuality')
        expect(sceneGeneration).not.toContain("reportProgress('inspecting'")
        expect(sceneGeneration).not.toContain('sceneReferenceRetryCorrection')
    })

    it('keeps location identity above reusable style motifs in generation and prompt editing', () => {
        expect(ai).toContain('buildSceneReferenceGenerationPrompt({')
        expect(promptRoute).toContain('projectVisualStyle')
        expect(promptRoute).toContain('const style = getVisualStyleForSetup(setup)')
        expect(promptRoute).toContain("the named location's category, physical function, scale, geography and navigable topology have higher content priority")
    })

    it('can regenerate one new candidate for every eligible scene without replacing selected references', () => {
        expect(page).toContain("onClick={() => generateAllSceneRefs('all')}")
        expect(page).toContain("t('全部重新生成候选')")
        expect(page).toContain('当前定稿图和已有候选图都会保留')
        expect(job).toContain('const nextSelectedReferenceUrls = selectedReferenceUrls.length > 0 ? selectedReferenceUrls : [url]')
    })

    it('gives each manual request a fresh identity instead of resuming an older image task', () => {
        expect(page).toContain('requestId: crypto.randomUUID()')
        expect(route).toContain('const requestId = resolveGenerationRequestId(body.requestId)')
        expect(job).toContain('generationNonce: requestId')
    })

    it('cancels queued work when the scene prompt changes before provider execution', () => {
        expect(route).toContain('sourceOperationVersion: scene.operationVersion')
        expect(job).toContain('source.operationVersion !== sourceOperationVersion')
        expect(job).toContain('throw new StaleReferenceMutationError()')
    })
})
