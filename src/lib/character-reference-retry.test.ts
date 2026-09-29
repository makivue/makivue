import { describe, expect, it } from 'vitest'
import {
    buildCharacterTurnaroundPromptVersion,
    CHARACTER_REFERENCE_PROMPT_VERSION_MAX_LENGTH,
    CHARACTER_SINGLE_SUBJECT_NEGATIVE,
    CHARACTER_TURNAROUND_SHEET_NEGATIVE,
    characterReferenceFramingPrompt,
    characterReferenceAnimalSpecies,
    characterReferenceRetryCorrection,
    characterReferenceSubjectProfile,
    characterTurnaroundLayout,
    filterTurnaroundInspectionIssues,
    sanitizeCharacterReferenceSheetPrompt
} from './character-reference-retry'
import { CHARACTER_REFERENCE_PROMPT_VERSION } from './character-reference-policy'

describe('character reference quality retry', () => {
    it('keeps the composite turnaround prompt version within persisted column limits', () => {
        const promptVersion = buildCharacterTurnaroundPromptVersion(CHARACTER_REFERENCE_PROMPT_VERSION)

        expect(promptVersion).toBe('character-reference/live-action-natural-v2@2026-08-13+turnaround-sheet-v12@2026-09-14')
        expect(promptVersion.length).toBeLessThanOrEqual(CHARACTER_REFERENCE_PROMPT_VERSION_MAX_LENGTH)
    })

    it.each(['character-reference/stylized-v1+turnaround-sheet-v6@2026-09-03', 'character-reference/stylized-v1+turnaround-sheet-v9@2026-09-04'])(
        'identifies stored legacy sheets from %s',
        promptVersion => {
            expect(characterTurnaroundLayout(promptVersion)).toBe('legacy')
        }
    )

    it('identifies sheets generated with the current five-depiction contract', () => {
        expect(characterTurnaroundLayout(buildCharacterTurnaroundPromptVersion(CHARACTER_REFERENCE_PROMPT_VERSION))).toBe('compact')
        expect(characterTurnaroundLayout('character-reference/stylized-v1+turnaround-sheet-v10@2026-09-08')).toBe('compact')
    })

    it.each([null, undefined, '', 'character-reference/stylized-v1', 'character-reference/turnaround-sheet-v13@2026-10-01'])(
        'does not guess the layout when its metadata is unknown: %s',
        promptVersion => {
            expect(characterTurnaroundLayout(promptVersion)).toBe('unknown')
        }
    )

    it('locks a full-body reference to one subject and one image', () => {
        const prompt = characterReferenceFramingPrompt('full_body')
        expect(prompt).toContain('EXACTLY ONE character')
        expect(prompt).toContain('both feet fully inside frame')
        expect(prompt).toContain('no collage')
        expect(prompt).toContain('PURE WHITE (#FFFFFF)')
        expect(CHARACTER_SINGLE_SUBJECT_NEGATIVE).toContain('multiple characters')
        expect(CHARACTER_SINGLE_SUBJECT_NEGATIVE).toContain('colored background')
    })

    it('turns inspection failures into targeted regeneration instructions', () => {
        const correction = characterReferenceRetryCorrection('full_body', {
            singleCharacter: false,
            faceVisible: true,
            fullBodyVisible: false,
            identityReady: false,
            angleMatch: false,
            whiteBackground: false,
            issues: ['multiple_characters', 'collage', 'cropped body', 'non-human subject']
        })
        expect(correction).toContain('exactly one visible subject')
        expect(correction).toContain('Pull the camera farther back')
        expect(correction).toContain('must exactly match')
        expect(correction).toContain('uniform pure white')
    })

    it('defines a compact sheet with one identity close-up and four useful full-body directions', () => {
        const prompt = characterReferenceFramingPrompt('turnaround_sheet')
        expect(prompt).toContain('one seamless 16:9 horizontal canvas')
        expect(prompt).toContain('exactly 5 depictions of one identity in one continuous horizontal row')
        expect(prompt).toContain('exactly 4 equal-scale complete-subject views')
        expect(prompt).toContain('0° front, 45° front-left three-quarter, 90° left profile, 180° rear')
        expect(prompt).toContain('full-body slot 1=0° front; full-body slot 2=45° front-left three-quarter; full-body slot 3=90° left profile; full-body slot 4=180° rear')
        expect(prompt).not.toMatch(/135°|225°|270°|315°|21:9/)
        expect(prompt).toContain('roughly one quarter of the canvas width')
        expect(prompt).toContain('never mirror, reorder, skip or replace a slot')
        expect(prompt).toContain('correct anatomical side instead of mirroring')
        expect(prompt).toContain('identity consistency must be absolute')
        expect(prompt).toContain('flat pure white (#FFFFFF)')
        expect(prompt).toContain('no cast shadow, contact shadow')
        expect(prompt).toContain('render absolutely no typography or written glyphs anywhere')
        expect(CHARACTER_TURNAROUND_SHEET_NEGATIVE).toContain('fewer than 4 distinct full-body views')
        expect(CHARACTER_TURNAROUND_SHEET_NEGATIVE).toContain('more than 4 full-body views')
        expect(CHARACTER_TURNAROUND_SHEET_NEGATIVE).toContain('duplicate camera angle')
        expect(CHARACTER_TURNAROUND_SHEET_NEGATIVE).toContain('incorrect camera-angle order')
        expect(CHARACTER_TURNAROUND_SHEET_NEGATIVE).toContain('angle labels')
        expect(CHARACTER_TURNAROUND_SHEET_NEGATIVE).not.toContain('multiple views')
    })

    it('repairs missing turnaround views without collapsing the sheet to one body', () => {
        const correction = characterReferenceRetryCorrection('turnaround_sheet', {
            singleCharacter: true,
            faceVisible: true,
            fullBodyVisible: false,
            identityReady: true,
            angleMatch: false,
            whiteBackground: true,
            frontViewVisible: true,
            leftThreeQuarterViewVisible: false,
            leftProfileViewVisible: true,
            backViewVisible: false,
            rightProfileViewVisible: false,
            rightThreeQuarterViewVisible: false,
            faceCloseupVisible: true,
            identityConsistentAcrossViews: true,
            fullBodyViewCount: 2,
            distinctFullBodyViewCount: 2,
            issues: ['missing 45-degree and back views']
        })
        expect(correction).toContain('Restore 2 missing distinct full-body angle slots')
        expect(correction).toContain('exactly 4 different views')
        expect(correction).toContain('exactly 5 depictions of one identity')
        expect(correction).toContain('0° front, 45° front-left three-quarter, 90° left profile, 180° rear')
        expect(correction).toContain('one seamless 16:9 horizontal canvas')
        expect(correction).toContain('slot 2 must be rebuilt as an unambiguous 45° front-left three-quarter complete-subject view')
        expect(correction).toContain('slot 4 must be rebuilt as an unambiguous 180° rear complete-subject view')
    })

    it('removes shot-specific lighting, poses and handheld props from identity input', () => {
        const prompt = sanitizeCharacterReferenceSheetPrompt(
            'cybernetic captain, matte black armor, carrying a giant warhammer, dramatic red backlighting, motion-ready aggressive posture, photorealistic live-action'
        )

        expect(prompt).toBe('cybernetic captain, matte black armor, photorealistic live-action')
    })

    it('adapts identity framing to concealed, quadruped and nonstandard anatomy', () => {
        expect(characterReferenceSubjectProfile('helmet completely concealing face, tactical armor')).toBe('concealed_head')
        expect(characterReferenceFramingPrompt('turnaround_sheet', 'concealed_head')).toContain('keep the face concealed')
        expect(characterReferenceSubjectProfile('quadruped robotic hound with armored paws')).toBe('quadruped')
        expect(characterReferenceFramingPrompt('turnaround_sheet', 'quadruped')).toContain('all legs and paws')
        expect(characterReferenceSubjectProfile('monstrous torso fused with a tracked base, no lower legs')).toBe('nonstandard_anatomy')
        expect(characterReferenceFramingPrompt('turnaround_sheet', 'nonstandard_anatomy')).toContain('never invent human legs or feet')
    })

    it('derives animal species and anatomy from Chinese character names', () => {
        expect(characterReferenceAnimalSpecies('巨型雄狮')).toBe('male lion')
        expect(characterReferenceAnimalSpecies('小松鼠')).toBe('squirrel')
        expect(characterReferenceAnimalSpecies('斑纹毒蛇')).toBe('snake')
        expect(characterReferenceAnimalSpecies('巨蝎')).toBe('scorpion')
        expect(characterReferenceSubjectProfile('巨型雄狮')).toBe('quadruped')
        expect(characterReferenceSubjectProfile('斑纹毒蛇')).toBe('nonstandard_anatomy')
    })

    it('turns a wrong human substitute into a hard subject-type correction', () => {
        const correction = characterReferenceRetryCorrection('turnaround_sheet', {
            singleCharacter: true,
            subjectTypeMatch: false,
            faceVisible: true,
            fullBodyVisible: true,
            identityReady: true,
            angleMatch: true,
            whiteBackground: true,
            frontViewVisible: true,
            leftThreeQuarterViewVisible: true,
            leftProfileViewVisible: true,
            backViewVisible: true,
            faceCloseupVisible: true,
            identityConsistentAcrossViews: true,
            fullBodyViewCount: 4,
            distinctFullBodyViewCount: 4,
            duplicateViewDetected: false,
            duplicateViewPairs: [],
            issues: ['Expected a lion but received a human man']
        })

        expect(correction).toContain('The rendered subject type is wrong')
        expect(correction).toContain('remove every human face, human body, human skin, human hairstyle and human wardrobe')
    })

    it('preserves fixed-count, fixed-order and missing-angle complaints for targeted retries', () => {
        expect(
            filterTurnaroundInspectionIssues([
                'Contains 3 full-body views instead of the required 4',
                'Incorrect order of views',
                'Missing strict left profile view',
                'Missing the left three-quarter full-body view',
                'Severe identity inconsistency across views'
            ])
        ).toEqual([
            'Contains 3 full-body views instead of the required 4',
            'Incorrect order of views',
            'Missing strict left profile view',
            'Missing the left three-quarter full-body view',
            'Severe identity inconsistency across views'
        ])
    })

    it('feeds four-view requirements back into a retry prompt', () => {
        const correction = characterReferenceRetryCorrection('turnaround_sheet', {
            singleCharacter: true,
            faceVisible: true,
            fullBodyVisible: true,
            identityReady: true,
            angleMatch: false,
            whiteBackground: true,
            faceCloseupVisible: true,
            identityConsistentAcrossViews: true,
            fullBodyViewCount: 3,
            distinctFullBodyViewCount: 3,
            issues: ['Contains 3 full-body views instead of the required 4', 'Incorrect order of views', 'Missing strict left profile view']
        })

        expect(correction).toContain('required 4')
        expect(correction).toContain('Incorrect order')
        expect(correction).toContain('strict left profile')
        expect(correction).toContain('Restore 1 missing distinct full-body angle slot')
    })

    it('replaces duplicate turnaround slots with genuinely different whole-body directions', () => {
        const correction = characterReferenceRetryCorrection('turnaround_sheet', {
            singleCharacter: true,
            faceVisible: true,
            fullBodyVisible: true,
            identityReady: true,
            angleMatch: true,
            whiteBackground: true,
            faceCloseupVisible: true,
            identityConsistentAcrossViews: true,
            fullBodyViewCount: 4,
            distinctFullBodyViewCount: 2,
            duplicateViewPairs: ['1-2', '3-4'],
            issues: ['Full-body views 1 and 2 use the same camera angle']
        })

        expect(correction).toContain('The previous duplicate or near-duplicate pairs were 1-2, 3-4')
        expect(correction).toContain('slot 1=0° front; slot 2=45° front-left three-quarter; slot 3=90° left profile; slot 4=180° rear')
        expect(correction).toContain('A changed gaze, arm pose or prop position does not create a new angle')
        expect(correction).toContain('Restore 2 missing distinct full-body angle slots')
    })

    it('does not add a duplicate-specific repair when all reported views are distinct', () => {
        const correction = characterReferenceRetryCorrection('turnaround_sheet', {
            singleCharacter: true,
            faceVisible: true,
            fullBodyVisible: true,
            identityReady: true,
            angleMatch: true,
            whiteBackground: true,
            faceCloseupVisible: true,
            identityConsistentAcrossViews: true,
            fullBodyViewCount: 4,
            distinctFullBodyViewCount: 4,
            duplicateViewDetected: false,
            duplicateViewPairs: [],
            issues: []
        })

        expect(correction).not.toContain('Replace every duplicate or near-duplicate full-body slot')
        expect(correction).not.toContain('Restore')
    })

    it('treats a three-quarter view as a full-body angle instead of a crop', () => {
        const prompt = characterReferenceFramingPrompt('three_quarter_view')
        expect(prompt).toContain('FULL-BODY 45-DEGREE')
        expect(prompt).toContain('not a crop')
    })

    it('locks profile and back references to unambiguous orientations', () => {
        const profilePrompt = characterReferenceFramingPrompt('profile')
        expect(profilePrompt).toContain('STRICT FULL-BODY 90-DEGREE LEFT-SIDE PROFILE')
        expect(profilePrompt).toContain('orthographic side elevation')
        expect(profilePrompt).toContain('nose points toward image-right')
        expect(profilePrompt).toContain('rotate the whole body rather than only the head')
        expect(characterReferenceFramingPrompt('back')).toContain('EXACT FULL-BODY 180-DEGREE REAR VIEW')
    })

    it('turns a rejected profile into a whole-body orthographic correction', () => {
        const correction = characterReferenceRetryCorrection('profile', {
            singleCharacter: true,
            faceVisible: true,
            fullBodyVisible: true,
            identityReady: true,
            angleMatch: false,
            whiteBackground: true,
            issues: ['Incorrect angle: not a strict 90-degree profile view']
        })
        expect(correction).toContain('orthographic 90-degree left-side elevation')
        expect(correction).toContain('Rotate the whole body, not only the head')
        expect(correction).toContain('no frontal torso or three-quarter pose')
    })

    it('keeps every identity role isolated on the same white background', () => {
        for (const role of ['full_body', 'three_quarter_view', 'profile', 'back', 'face'] as const) {
            const prompt = characterReferenceFramingPrompt(role)
            expect(prompt).toContain('PURE WHITE (#FFFFFF)')
            expect(prompt).toContain('no visible room, scenery, environment')
        }
    })
})
