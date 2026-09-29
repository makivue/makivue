import { describe, expect, it } from 'vitest'
import { assessCharacterReferenceQuality, summarizeTurnaroundViews, type CharacterReferenceQualityAssessment } from './character-reference-retry'

function turnaroundQuality(overrides: Partial<CharacterReferenceQualityAssessment> = {}): CharacterReferenceQualityAssessment {
    return {
        score: 86,
        singleCharacter: true,
        subjectTypeMatch: true,
        faceVisible: true,
        fullBodyVisible: true,
        identityReady: true,
        angleMatch: true,
        whiteBackground: true,
        frontViewVisible: true,
        leftThreeQuarterViewVisible: true,
        leftProfileViewVisible: true,
        rearLeftThreeQuarterViewVisible: false,
        backViewVisible: true,
        rearRightThreeQuarterViewVisible: false,
        rightProfileViewVisible: false,
        rightThreeQuarterViewVisible: false,
        faceCloseupVisible: true,
        identityConsistentAcrossViews: true,
        fullBodyViewCount: 4,
        distinctFullBodyViewCount: 4,
        duplicateViewDetected: false,
        duplicateViewPairs: [],
        issues: [],
        ...overrides
    }
}

describe('character reference quality policy', () => {
    it('accepts a complete turnaround sheet immediately when every view is distinct', () => {
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality(), false)).toMatchObject({
            hardRejected: false,
            strictAccepted: true
        })
    })

    it('accepts the four core angles without requesting retired rear-quarter and mirrored views', () => {
        const quality = turnaroundQuality({
            fullBodyViewCount: undefined,
            distinctFullBodyViewCount: undefined,
            rearLeftThreeQuarterViewVisible: undefined,
            rearRightThreeQuarterViewVisible: undefined,
            rightProfileViewVisible: undefined,
            rightThreeQuarterViewVisible: undefined
        })
        expect(summarizeTurnaroundViews(quality).distinctViewCount).toBe(4)
        expect(assessCharacterReferenceQuality('turnaround_sheet', quality, false).strictAccepted).toBe(true)
    })

    it.each(['frontViewVisible', 'leftThreeQuarterViewVisible', 'leftProfileViewVisible', 'backViewVisible'] as const)(
        'rejects a missing %s even when the inspector reports four distinct bodies and a matching angle',
        field => {
            expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ [field]: false }), false).hardRejected).toBe(true)
        }
    )

    it('rejects extra full-body views in new generations instead of keeping a crowded sheet', () => {
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ fullBodyViewCount: 8, distinctFullBodyViewCount: 8 }), false).hardRejected).toBe(true)
    })

    it('rejects an incomplete or incorrectly ordered angle sequence', () => {
        const decision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                fullBodyViewCount: 2,
                distinctFullBodyViewCount: 2,
                leftThreeQuarterViewVisible: false,
                rightProfileViewVisible: false,
                angleMatch: false,
                issues: ['Incorrect number of full-body views (found 2, expected 4)', 'Incorrect order of views']
            }),
            false
        )

        expect(decision).toMatchObject({ hardRejected: true, strictAccepted: false, fallbackEligible: false })
    })

    it('uses the distinct view count instead of the larger total figure count', () => {
        const quality = turnaroundQuality({
            frontViewVisible: false,
            leftThreeQuarterViewVisible: false,
            leftProfileViewVisible: false,
            rearLeftThreeQuarterViewVisible: false,
            backViewVisible: false,
            rearRightThreeQuarterViewVisible: false,
            rightProfileViewVisible: false,
            rightThreeQuarterViewVisible: false,
            fullBodyViewCount: 4,
            distinctFullBodyViewCount: 3
        })

        expect(summarizeTurnaroundViews(quality).distinctViewCount).toBe(3)
        expect(assessCharacterReferenceQuality('turnaround_sheet', quality, false)).toMatchObject({
            hardRejected: true,
            strictAccepted: false
        })
    })

    it('rejects duplicate slots even when several genuinely distinct views remain', () => {
        const decision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                fullBodyViewCount: 4,
                distinctFullBodyViewCount: 2,
                leftProfileViewVisible: false,
                rightProfileViewVisible: false,
                duplicateViewPairs: ['1-2', '3-4'],
                issues: ['Views 1 and 2 are near-duplicates', 'Views 3 and 4 are near-duplicates']
            }),
            false
        )

        expect(decision).toMatchObject({ hardRejected: true, strictAccepted: false, fallbackEligible: false })
    })

    it('infers duplicates when total and distinct counts disagree even if the detector flag is inconsistent', () => {
        const decision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                fullBodyViewCount: 4,
                distinctFullBodyViewCount: 2,
                duplicateViewDetected: false,
                duplicateViewPairs: []
            }),
            false
        )

        expect(decision).toMatchObject({ hardRejected: true, strictAccepted: false, fallbackEligible: false })
    })

    it('uses normalized duplicate groups to reject a contradictory reported view count', () => {
        const quality = turnaroundQuality({
            fullBodyViewCount: 4,
            distinctFullBodyViewCount: 4,
            duplicateViewDetected: false,
            duplicateViewPairs: ['2-1', '1-2', '2-5', 'not-a-pair']
        })

        expect(summarizeTurnaroundViews(quality)).toMatchObject({
            totalViewCount: 4,
            distinctViewCount: 3,
            duplicateViewDetected: true,
            duplicateViewPairs: ['1-2'],
            redundantViewCount: 1
        })
        expect(assessCharacterReferenceQuality('turnaround_sheet', quality, false)).toMatchObject({
            hardRejected: true,
            strictAccepted: false,
            fallbackEligible: false
        })
    })

    it('keeps severe body cropping as a hard failure', () => {
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ fullBodyVisible: false }), false).fallbackEligible).toBe(false)
    })

    it('treats fixed-angle, background and face-inset failures as blocking', () => {
        const decision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                score: 55,
                angleMatch: false,
                whiteBackground: false,
                faceCloseupVisible: false,
                fullBodyViewCount: 3,
                distinctFullBodyViewCount: 3,
                issues: ['Missing rear view', 'Contains 3 full-body views instead of the required 4', 'Incorrect order of views']
            }),
            false
        )

        expect(decision).toMatchObject({ hardRejected: true, strictAccepted: false, fallbackEligible: false })
    })

    it('keeps a low aggregate score advisory after the exact composition passes', () => {
        const decision = assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ score: 55 }), false)

        expect(decision).toMatchObject({ hardRejected: false, strictAccepted: false, fallbackEligible: true })
        expect(decision.advisoryIssues).toContain('综合评分 55，但已满足核心身份与视角门槛')
    })

    it('keeps the best species-correct four-view sheet after strict angle retries are exhausted', () => {
        const decision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                angleMatch: false,
                leftThreeQuarterViewVisible: false,
                issues: ['Slot 2 is right-facing instead of front-left']
            }),
            false
        )

        expect(decision).toMatchObject({ hardRejected: true, strictAccepted: false, fallbackEligible: true })
        expect(decision.advisoryIssues).toContain('物种、身份和四个独立全身视图正确，但角度顺序未完全达到严格模板')
    })

    it('never keeps a wrong-species sheet as a fallback', () => {
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ subjectTypeMatch: false, angleMatch: false }), false).fallbackEligible).toBe(false)
    })

    it('rejects even slight accessory-edge cropping so all four bodies remain complete', () => {
        const decision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({ fullBodyVisible: false, issues: ['Slight cropping of accessories (chains/skulls) on the outermost views.'] }),
            false
        )

        expect(decision).toMatchObject({ hardRejected: true, strictAccepted: false, fallbackEligible: false })
    })

    it('penalizes duplicate pairs when ranking otherwise equivalent fallback candidates', () => {
        const uniqueDecision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                fullBodyViewCount: 4,
                distinctFullBodyViewCount: 4
            }),
            false
        )
        const duplicateDecision = assessCharacterReferenceQuality(
            'turnaround_sheet',
            turnaroundQuality({
                fullBodyViewCount: 4,
                distinctFullBodyViewCount: 2,
                leftProfileViewVisible: false,
                rightProfileViewVisible: false,
                duplicateViewDetected: true,
                duplicateViewPairs: ['1-2', '3-4']
            }),
            false
        )

        expect(duplicateDecision.candidateScore).toBe(uniqueDecision.candidateScore - 26)
    })

    it('rejects identity drift, text, and severely incomplete sheets', () => {
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ subjectTypeMatch: false }), false).hardRejected).toBe(true)
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality({ identityConsistentAcrossViews: false }), false).hardRejected).toBe(true)
        expect(assessCharacterReferenceQuality('turnaround_sheet', turnaroundQuality(), true).hardRejected).toBe(true)
        expect(
            assessCharacterReferenceQuality(
                'turnaround_sheet',
                turnaroundQuality({
                    fullBodyViewCount: 3,
                    distinctFullBodyViewCount: 3,
                    leftThreeQuarterViewVisible: false,
                    leftProfileViewVisible: false,
                    backViewVisible: false,
                    rightProfileViewVisible: false
                }),
                false
            ).hardRejected
        ).toBe(true)
    })

    it('keeps single-view character references on the strict policy', () => {
        expect(assessCharacterReferenceQuality('profile', turnaroundQuality({ angleMatch: false }), false)).toMatchObject({
            hardRejected: true,
            strictAccepted: false
        })
    })
})
