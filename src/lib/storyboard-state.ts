export function extractStoryboardBoundaryStates(actionDesc: string | null | undefined) {
    const value = actionDesc?.trim() ?? ''
    if (!value) return { openingState: null, endingState: null }
    const openingState = value.match(/Opening state\s*[:：]\s*([\s\S]*?)(?=[;；\s]*(?:Middle state\s*\d*|Ending state)\s*[:：]|$)/i)?.[1]?.trim() || null
    const endingState = value.match(/Ending state\s*[:：]\s*([\s\S]*)$/i)?.[1]?.trim() || null
    return { openingState, endingState }
}
