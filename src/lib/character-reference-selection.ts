export type CharacterIdentityReferenceRole = 'turnaround_sheet' | 'full_body' | 'three_quarter_view' | 'profile' | 'back' | 'face'

export type CharacterReferenceShotContext = {
    shotType?: string | null
    actionDesc?: string | null
    imagePrompt?: string | null
}

/**
 * The approved turnaround sheet is the canonical identity source for every
 * shot. It already contains face, front, 45°, side and back views, so separate
 * angle images would add conflicting wardrobe and identity signals.
 */
export function characterReferenceRoleForShot(input: CharacterReferenceShotContext | string | null | undefined): CharacterIdentityReferenceRole {
    void input
    return 'turnaround_sheet'
}

export function characterReferenceRoleLabel(role: CharacterIdentityReferenceRole) {
    if (role === 'turnaround_sheet') return 'multi-view character turnaround sheet'
    if (role === 'face') return 'face close-up'
    if (role === 'profile') return 'full-body side profile'
    if (role === 'back') return 'full-body rear view'
    if (role === 'three_quarter_view') return 'full-body 45-degree view'
    return 'front full-body'
}

export function characterReferenceFallbackRoles(role: CharacterIdentityReferenceRole): CharacterIdentityReferenceRole[] {
    void role
    return ['turnaround_sheet']
}
