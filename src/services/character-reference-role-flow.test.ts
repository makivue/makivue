import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('REF-011 character reference roles', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/page.tsx'), 'utf8')
    const globalStyles = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const projectRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/projects/[id]/route.ts'), 'utf8')
    const referenceRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/characters/[id]/reference/route.ts'), 'utf8')
    const referenceJob = fs.readFileSync(path.join(process.cwd(), 'src/services/character-reference-job.ts'), 'utf8')
    const batchRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/projects/[id]/character-references/route.ts'), 'utf8')
    const batchStatusRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/projects/[id]/character-references/status/[jobId]/route.ts'), 'utf8')
    const batchService = fs.readFileSync(path.join(process.cwd(), 'src/services/character-reference-batch.ts'), 'utf8')
    const refImageJobStore = fs.readFileSync(path.join(process.cwd(), 'src/lib/refImageJobStore.ts'), 'utf8')
    const ai = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')

    it('returns and renders only the multi-view turnaround sheet', () => {
        expect(projectRoute).toContain("role: 'turnaround_sheet'")
        expect(projectRoute).not.toContain("where: { deletedAt: null, role: 'state_reference' }")
        const roleConfig = page.match(/const CHARACTER_IDENTITY_REFERENCE_ROLES:[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] ?? ''
        expect(roleConfig).toContain("role: 'turnaround_sheet'")
        expect(roleConfig).not.toContain("role: 'full_body'")
        expect(roleConfig).not.toContain("role: 'three_quarter_view'")
        expect(roleConfig).not.toContain("role: 'profile'")
        expect(roleConfig).not.toContain("role: 'back'")
        expect(roleConfig).not.toContain("role: 'face'")
    })

    it('keeps role cards image-first without verbose framing or state descriptions', () => {
        expect(page).not.toContain('referenceRole.description')
        expect(page).not.toContain('同一身份，不同服装 / 表情 / 动作')
        expect(page).not.toContain('角色视觉描述 / 图像提示词')
        expect(page).not.toContain('暂无提示词，点击展开填写')
        expect(page).not.toContain('expandedCharacterPromptIds')
        expect(page).toContain('onClick={() => openCharacterPromptEditor(char)}')
        expect(page).toContain('title="编辑角色 Prompt"')
        expect(page).not.toContain('state.episodeNumbers.join')
        expect(page).not.toContain('title={state.prompt}')
        expect(page).toContain('CHARACTER_IDENTITY_REFERENCE_ROLES.map(referenceRole =>')
    })

    it('does not render historical single-angle assets', () => {
        expect(page).not.toContain('function displayedCharacterIdentityRoles(character: Character)')
        expect(page).toContain('CHARACTER_IDENTITY_REFERENCE_ROLES.map(referenceRole =>')
    })

    it('fits the full reference sheet inside the viewport preview', () => {
        expect(page).toContain('relative flex h-full w-full min-h-0 min-w-0 flex-col')
        expect(page).toContain('flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden')
        expect(page).toContain('<OptimizedMediaImage')
        expect(page).toContain('className="object-contain"')
        expect(page).toContain('onClick={event => event.stopPropagation()}')
        expect(page).toContain('aria-label="关闭图片预览"')
        expect(page).not.toContain('<div className="truncate text-sm text-gray-200">{referencePreview.title}</div>')
        expect(page).not.toContain('max-w-5xl')
    })

    it('navigates a character candidate gallery and confirms the visible image from the preview', () => {
        expect(page).toContain("kind: 'character'")
        expect(page).toContain('urls: previewUrls')
        expect(page).toContain("event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'")
        expect(page).toContain('moveReferencePreview(-1)')
        expect(page).toContain('moveReferencePreview(1)')
        expect(page).toContain('selectCharRef(referencePreview.targetId, referencePreviewUrl, referencePreview.role)')
    })

    it('keeps empty and populated sheet frames at the same aspect ratio and overlays their actions', () => {
        expect(globalStyles).toMatch(/\.studio-character-sheet,\s*\.studio-character-sheet-empty\s*\{[^}]*aspect-ratio: 16 \/ 9;/)
        expect(globalStyles).toMatch(/\.studio-character-sheet-preview\s*\{[^}]*width: 100%;[^}]*height: 100%;/)
        expect(page).toContain('className="h-full w-full object-contain"')
        expect(globalStyles).toMatch(/\.studio-character-sheet-toolbar\s*\{[^}]*position: absolute;[^}]*bottom: 6px;/)
        expect(globalStyles).toMatch(/\.studio-character-sheet-status\s*\{[^}]*border-radius: 999px;/)
        expect(globalStyles).not.toMatch(/\.studio-character-sheet-toolbar\s*\{[^}]*border-top:/)
    })

    it('keeps candidate and selected state for the turnaround sheet', () => {
        expect(referenceRoute).toContain('where: { characterId: idNum, role, status:')
        expect(referenceJob).toContain("const shouldSelect = replaceSelected || (!existingSelected && !(role === 'turnaround_sheet' && character.referenceImageUrl))")
        expect(referenceJob).toContain("const primarySheetChanged = role === 'turnaround_sheet'")
        expect(referenceJob).toContain("status: shouldSelect ? 'selected' : 'candidate'")
        expect(referenceJob).toContain("role === 'turnaround_sheet' ? [url")
        expect(referenceJob).not.toContain("role === 'state'")
        expect(page).toContain("body: JSON.stringify({ action: 'select', url, role })")
    })

    it('generates one complete production sheet per character', () => {
        expect(page).toContain("return ['turnaround_sheet']")
        expect(page).toContain('productionCharacterIdentityRoles()')
        expect(page).toContain('character-references`, {')
        expect(page).toMatch(/pollCharacterReferenceBatch\(\s*activeProject.id,\s*jobId/)
        expect(page).not.toContain('runWithConcurrency(plannedIdentityTasks, concurrency')
        expect(page).not.toContain('scheduleProjectRefresh')
        expect(page).toContain('16:9 多视图设定板')
        expect(page).toContain('面部特写和正面、45°、侧面、背面四个全身视图')
        expect(page).toContain("const batchQuality: ImageQuality = 'ultra'")
        expect(ai).toContain("role === 'turnaround_sheet' ? CHARACTER_TURNAROUND_ASPECT_RATIO")
        expect(ai).toContain("role === 'turnaround_sheet' ? 'ultra'")
        expect(ai).toContain('const explicitAnimalSpecies = characterReferenceAnimalSpecies(characterIdentityContext)')
        expect(ai).toContain('ABSOLUTE SUBJECT TYPE:')
        expect(ai).toContain('subjectTypeNegative')
        expect(ai).toContain('inspectCharacterReferenceQuality(absPath, role, subjectProfile, resolvedAnimalSpecies)')
        expect(ai).toContain("['turnaround_sheet', 'three_quarter_view', 'profile', 'back'].includes(role)")
        expect(ai).toContain('subject-type or fixed-angle gate failed; retrying the same reference with another model and targeted correction')
        expect(page).not.toContain('queuedCharacterRefFor')
        expect(referenceRoute).toContain("value === undefined || value === null || value === 'turnaround_sheet'")
        expect(referenceRoute).toContain('单角度角色参考图已停用，请使用多视图角色设定板')
    })

    it('claims the shared account image slot before provider generation', () => {
        expect(referenceJob).toContain('waitForReferenceImageSlot({')
        expect(referenceJob.indexOf('waitForReferenceImageSlot({')).toBeLessThan(referenceJob.indexOf('await runCharacterReferenceJob(input)'))
        expect(referenceRoute).toContain('export const maxDuration = 1800')
    })

    it('cancels queued work when the character prompt changes before provider execution', () => {
        expect(referenceRoute).toContain('sourceOperationVersion: character.operationVersion')
        expect(batchRoute).toContain('sourceOperationVersion: characterById.get(requestedTask.characterId)?.operationVersion')
        expect(referenceJob).toContain('source.operationVersion !== sourceOperationVersion')
        expect(referenceJob).toContain('throw new StaleReferenceMutationError()')
    })

    it('submits one batch, polls one aggregate status, and limits server workers', () => {
        expect(batchRoute).toContain("createProjectJob(projectId.toString(), 'character_references'")
        expect(batchRoute).toContain('runCharacterReferenceBatchJob(parentJob.id, payload, tasks)')
        expect(batchStatusRoute).toContain('const childJobs = await getJobs(')
        expect(batchService).toContain('runWithConcurrency(tasks, REFERENCE_BATCH_CONCURRENCY')
        expect(page).toContain('jitterRatio: 0.15')
    })

    it('reveals each character image as soon as its batch item completes', () => {
        expect(page).toContain('const displayedCharacterReferenceJobIds = new Set<string>()')
        expect(page).toContain("item.phase === 'done' && item.result && !displayedCharacterReferenceJobIds.has(item.jobId)")
        expect(page).toContain('displayCharacterReferenceResults(completedResults, selectionVersions)')
        expect(page).not.toContain('if (hasNewCompletedImage) void fetchProject()')
    })

    it('recovers concurrent active-key inserts instead of returning a unique error', () => {
        expect(refImageJobStore).toContain('if (!isP2002Error(error)) throw error')
        expect(refImageJobStore).toContain('const duplicate = await prisma.refImageJob.findUnique({ where: { activeKey } })')
        expect(refImageJobStore).toContain('reused = true')
    })

    it('can regenerate every role and replace selected assets only after each new image succeeds', () => {
        expect(page).toMatch(/generateAllCharRefs\(\s*mode: 'missing' \| 'all' = 'missing',\s*options:/)
        expect(page).toContain("mode === 'all' || !selectedCharacterRoleAsset")
        expect(page).toContain('const replaceSelected = (existingBatch?.replaceSelected ?? options.replaceSelected) === true')
        expect(page).toContain('replaceSelected,')
        expect(page).toContain("t('全部重新生成候选')")
        expect(page).toContain("generateAllCharRefs('all')")
        expect(referenceRoute).toContain('const replaceSelected = body.replaceSelected === true')
        expect(referenceRoute).toContain("mode: replaceSelected ? 'replace-selected' : 'candidate'")
        expect(referenceRoute).toContain("data: { status: 'candidate' }")
        expect(referenceJob).toContain("status: shouldSelect ? 'selected' : 'candidate'")
        expect(page).toContain('generateCharRefFromCard(char, referenceRole.role, true)')
        expect(referenceJob).toContain('const replacingLegacyAnimalSheets =')
        expect(referenceJob).toContain("data: { status: 'candidate', deletedAt: new Date() }")
    })

    it('keeps card-level failures visible while the batch summary stays compact', () => {
        expect(page).toContain('const [characterGenerationErrors, setCharacterGenerationErrors]')
        expect(page).toContain('const [lastCharacterBatchFailures, setLastCharacterBatchFailures]')
        expect(page).toContain('const manuallyGeneratingCharacterRefs = useRef(new Set<string>())')
        expect(page).toContain('!manuallyGeneratingCharacterRefs.current.has(key) && !supersededCharacterBatchFailures.current.has(key)')
        expect(page).toContain('if (supersededCharacterBatchFailures.current.has(key)) continue')
        expect(page).toContain("const generationActionLabel = retryBatchFailure ? t('重新生成') : t('生成 5 画面候选图')")
        expect(page).toContain('disabled={characterBatchRestoring || generating || promptBusy || !promptValue.trim() || (!!charBatch && !retryBatchFailure)}')
        expect(page).toContain('生成失败：{generationError}')
        expect(page).toContain('!generating && generationError && (')
        expect(page).toContain('title={`生成失败：${generationError}`}')
        expect(page).not.toContain('generationError}</span>')
        expect(page).toContain('progress={charBatch}')
        expect(page).not.toContain('visibleCharacterBatchFailures.map')
        expect(page).not.toContain('进行中 {charBatchActive}')
        expect(page).not.toContain('排队 {charBatchQueued}')
        expect(page).toContain("errorCode === 'HIMODELS_IMAGE_THINKING_ROUTE'")
        expect(page).toContain("errorCode === 'HIMODELS_IMAGE_EMPTY_RESPONSE'")
        expect(page).toContain("reasons.push('物种或身体结构不正确')")
        expect(page).toContain("reasons.push('主体未完整入镜')")
    })

    it('uses only the turnaround sheet downstream and enforces the active provider slot budget', () => {
        expect(ai).toContain('characterReferenceRoleForShot({')
        expect(ai).toContain("role: 'turnaround_sheet'")
        expect(ai).toContain('characterReferenceFallbackRoles(preferredIdentityRole)')
        expect(ai).toContain('TURNAROUND SHEET USAGE LOCK')
        expect(ai).toContain('referenceImageBudget')
        expect(ai).toContain('referenceImages.length >= referenceImageBudget')
        expect(ai).toContain('for (const selection of characterReferenceSelections) pushBudgetedReference(selection.primaryUrl)')
    })
})
