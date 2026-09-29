interface CharacterReferenceView {
    id: string
    referenceImageUrl: string | null
    referenceCandidates: string | null
    referenceAssetRows?: Array<{
        id: string
        role: string
        stateKey: string | null
        url: string
        status: string
        promptVersion?: string | null
    }>
}

interface CharacterReferenceResult {
    targetType: 'character' | 'scene'
    targetId: string
    candidateUrl: string
    referenceImageUrl: string | null
    referenceCandidates: string[]
    role?: string
    stateKey?: string
    promptVersion?: string
}

/** Render a persisted sheet directly from its job result, without a project reload. */
export function applyCharacterReferenceResult<T extends CharacterReferenceView>(character: T, jobId: string, result: CharacterReferenceResult, preserveSelection = false): T {
    const role = result.role ?? 'turnaround_sheet'
    if (result.targetType !== 'character' || result.targetId !== character.id || role !== 'turnaround_sheet' || result.stateKey || !result.candidateUrl) return character

    const referenceImageUrl = preserveSelection ? character.referenceImageUrl : result.referenceImageUrl
    const assets = (character.referenceAssetRows ?? []).map(asset =>
        asset.role === role && !asset.stateKey ? { ...asset, status: asset.url === referenceImageUrl ? 'selected' : asset.status === 'selected' ? 'candidate' : asset.status } : asset
    )
    const existing = assets.find(asset => asset.role === role && !asset.stateKey && asset.url === result.candidateUrl)
    const completedAsset = {
        ...existing,
        id: existing?.id ?? `reference-job:${jobId}`,
        role,
        stateKey: null,
        url: result.candidateUrl,
        status: result.candidateUrl === referenceImageUrl ? 'selected' : 'candidate',
        promptVersion: result.promptVersion ?? existing?.promptVersion ?? null
    }
    return {
        ...character,
        referenceImageUrl,
        referenceCandidates: JSON.stringify(result.referenceCandidates),
        referenceAssetRows: [completedAsset, ...assets.filter(asset => asset !== existing)]
    }
}
