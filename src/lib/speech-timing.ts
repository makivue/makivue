/** Shared natural-speech estimate; speaker labels are not spoken words. */
export function estimateSpeechDurationSeconds(text: string | null | undefined, stripSpeakerLabels = true): number {
    const value = (stripSpeakerLabels ? text?.replace(/^[^：:\n]{1,80}[：:]\s*/gm, '') : text)?.trim()
    if (!value) return 0
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
    const syllables = value.match(cjk)?.length ?? 0
    const words = value.replace(cjk, ' ').match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu)?.length ?? 0
    const pauses = value.match(/[，,。.!！？?；;：:…]/g)?.length ?? 0
    return Number((syllables / 4.2 + words / 2.6 + pauses * 0.12).toFixed(1))
}

/** Both channels occupy this clip; reserve room to enter and finish the speech. */
export function minimumStoryboardSpeechSeconds(input: { dialogue?: string | null; narration?: string | null }): number {
    const speech = estimateSpeechDurationSeconds(input.dialogue) + estimateSpeechDurationSeconds(input.narration)
    return speech > 0 ? Math.ceil(speech + 1) : 0
}

/** Planning headroom for delivery and reactions; the provider maximum remains the acceptance limit. */
export function getStoryboardSpeechPlanningTarget(maximumSeconds: number): number {
    return Math.min(maximumSeconds, Math.max(3, Math.floor(maximumSeconds * 0.9)))
}
