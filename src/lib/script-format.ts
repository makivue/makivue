import { normalizeContentLanguage } from './content-language'

/** Accept legacy Chinese headings and English screenplay headings without rewriting source text. */
export const SCRIPT_SCENE_PATTERN = /(?:【(?:场景|Scene)\s*[:：][^】\n]+】|\[(?:场景|Scene)\s*[:：][^\]\n]+\])/.source

export function getScriptLabels(language: unknown) {
    return normalizeContentLanguage(language) === 'en'
        ? {
              scene: 'Scene',
              description: 'Scene description',
              state: 'Character state',
              action: 'Action',
              expression: 'Expression',
              cue: 'Dialogue cue',
              narrator: 'Narrator',
              offscreen: 'voice over',
              inner: 'inner monologue'
          }
        : { scene: '场景', description: '场景描述', state: '人物状态', action: '动作', expression: '表情', cue: '台词提示', narrator: '旁白', offscreen: '画外音', inner: '内心' }
}

export function scriptFormatPrompt(language: unknown): string {
    const labels = getScriptLabels(language)
    const english = normalizeContentLanguage(language) === 'en'
    return `# Screenplay format
Use these exact structural labels:
- Scene heading: [${labels.scene}: <specific location> / <time of day> / <interior or exterior>]
- After every heading: (${labels.description}: <space, light, atmosphere and relevant props>)
- Initial character state: (Opening state: ...); after a change of scene: (${labels.state}: ...)
- Physical action: (${labels.action}: ...)
- Visible emotional reaction: (${labels.expression}: ...)
- Optional delivery instruction before speech: (${labels.cue}: ...)
- Spoken dialogue: <registered character name>: ...
- Speech through a phone, radio or from off screen: <registered character name> (${labels.offscreen}): ...; preserve the actual speaker and communication source, never relabel their speech as the narrator or an inner voice.
- Narration: ${labels.narrator}: ...
- Unspoken inner voice: <registered character name> (${labels.inner}): ...
- Final state: (Ending state: ...)
Opening state and Ending state are fixed continuity markers. Write all values, including location names, time of day, interior/exterior and speaker directions, in the project's content language. Preserve registered character names.
${english ? 'For English projects, the entire title, synopsis and script must be English, including every heading and parenthetical label. Use day/night and interior/exterior. Chinese instructions, examples, previous scripts or scene plans are reference material, not output templates; translate their meaning into English without adding or changing story facts.' : 'Keep the established structural labels above; write their values in the project content language.'}`
}

/** Shared by planning, adaptation, repair and semantic review. */
export const SCRIPT_FIDELITY_RULES = `Source adaptation fidelity:
Use the finalized chapter as the factual authority. Condense repeated description, not the story into a summary. Preserve the necessary sequence of motive/condition, action process, result and reaction; do not show only a result while skipping its cause.
For consequential props, specify who holds them, what they do, where the props go and how they are discovered. Preserve necessary reasons and bridges for entrances, exits and changes of place/time. Retain identity, experience, authorization or protective measures that explain how an action is possible. Use concise records, screen text or existing speech rather than invented explanatory dialogue.
Important events and consequences directly shown in the source must remain visible actions and state changes; do not replace them entirely with command screens, after-the-fact reports or narration. Events originally reported need no invented on-site scene. Depict dangerous or violent events through non-operational actions, reactions and outcomes; do not add real-world harmful procedures or repeat graphic details.
For violent events, preserve who acts against whom, the visible confrontation, its causal sequence and consequential injuries/deaths/escapes. Use restrained actions and reactions instead of anatomical gore or detailed harmful procedures. This equivalent dramatization is faithful adaptation, not a weakened or missing event. An aftermath alone is insufficient when the source shows a consequential confrontation. Scene plans must describe these factual beats concisely, without making each graphic detail a separate mandatory event; review and repair must apply the same standard even if a legacy plan quotes graphic source text.
Preserve the speaker and communication source of actual phone, radio and offscreen speech; never turn it into omniscient narration, inner monologue or silent action. Preserve questions, responses and the order of learning information.
Preserve participant counts, identities, injuries, prop ownership and who performs each action. Do not arbitrarily transfer speech, actions or a sacrifice to another person. If the source itself contradicts these facts, locate the contradiction in review rather than inventing a different outcome.
Repeated metaphors, decoration and irrelevant detail may be removed; reasonable time ellipsis is allowed. Word ratios, target runtime and scene counts must not justify losing necessary events or padding the script.`

/** Separate speech mode from character identity for validation and narration routing. */
export function parseScriptSpeaker(value: string): { name: string | null; mode: 'dialogue' | 'voice_over' | 'inner_monologue' } {
    const speaker = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    if (/^(?:旁白|画外音|内心独白|narration|narrator|voice[ -]?over|v\.?o\.?)$/i.test(speaker)) return { name: null, mode: 'voice_over' }
    const marked = speaker.match(/^(.+?)\s*\(\s*(内心|心声|独白|内心独白|画外|画外音|v\.?o\.?|o\.?s\.?|voice[ -]?over|off[ -]?screen|inner monologue)\s*\)$/i)
    if (!marked) return { name: speaker, mode: 'dialogue' }
    return { name: marked[1].trim(), mode: /^(?:内心|心声|独白|内心独白|inner monologue)$/i.test(marked[2]) ? 'inner_monologue' : 'voice_over' }
}
