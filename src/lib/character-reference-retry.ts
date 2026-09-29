export type CharacterReferenceQualityFeedback = {
    singleCharacter: boolean
    /** Whether the rendered subject matches the required human/animal/nonstandard body type. */
    subjectTypeMatch?: boolean
    faceVisible: boolean
    fullBodyVisible: boolean
    identityReady: boolean
    angleMatch: boolean
    whiteBackground: boolean
    frontViewVisible?: boolean
    leftThreeQuarterViewVisible?: boolean
    leftProfileViewVisible?: boolean
    rearLeftThreeQuarterViewVisible?: boolean
    backViewVisible?: boolean
    rearRightThreeQuarterViewVisible?: boolean
    rightProfileViewVisible?: boolean
    rightThreeQuarterViewVisible?: boolean
    faceCloseupVisible?: boolean
    identityConsistentAcrossViews?: boolean
    /** Total number of full-body figures, including repeated camera angles. */
    fullBodyViewCount?: number
    /** Number of genuinely different full-body camera directions. */
    distinctFullBodyViewCount?: number
    duplicateViewDetected?: boolean
    duplicateViewPairs?: string[]
    issues: string[]
}

export type CharacterReferenceQualityAssessment = CharacterReferenceQualityFeedback & { score: number }

export type CharacterReferenceRetryRole = 'turnaround_sheet' | 'full_body' | 'three_quarter_view' | 'profile' | 'back' | 'face'

export type CharacterReferenceSubjectProfile = 'humanoid' | 'concealed_head' | 'quadruped' | 'nonstandard_anatomy'

export type CharacterReferenceQualityDecision = {
    /** A hard failure is not safe to keep as an identity source. */
    hardRejected: boolean
    /** A strict pass can be accepted immediately without spending another retry. */
    strictAccepted: boolean
    /** A non-strict result that is still safe to keep after retries are exhausted. */
    fallbackEligible: boolean
    /** Higher values indicate a better fallback candidate after all retries. */
    candidateScore: number
    /** Non-blocking defects that may be shown to the user without regenerating the sheet. */
    advisoryIssues: string[]
}

export type CharacterTurnaroundViewSummary = {
    totalViewCount: number
    distinctViewCount: number
    duplicateViewDetected: boolean
    duplicateViewPairs: string[]
    redundantViewCount: number
}

export const CHARACTER_TURNAROUND_FULL_BODY_VIEWS = [
    { field: 'frontViewVisible', angle: 0, label: 'front' },
    { field: 'leftThreeQuarterViewVisible', angle: 45, label: 'front-left three-quarter' },
    { field: 'leftProfileViewVisible', angle: 90, label: 'left profile' },
    { field: 'backViewVisible', angle: 180, label: 'rear' }
] as const
export const CHARACTER_TURNAROUND_ASPECT_RATIO = '16:9'
export const CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS = CHARACTER_TURNAROUND_FULL_BODY_VIEWS.length
export const CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS = CHARACTER_TURNAROUND_FULL_BODY_VIEWS.length
export const CHARACTER_TURNAROUND_ANGLE_SEQUENCE = CHARACTER_TURNAROUND_FULL_BODY_VIEWS.map(view => `${view.angle}° ${view.label}`).join(', ')
const CHARACTER_TURNAROUND_SLOT_CONTRACT = CHARACTER_TURNAROUND_FULL_BODY_VIEWS.map((view, index) => `full-body slot ${index + 1}=${view.angle}° ${view.label}`).join('; ')
/** One composition contract shared by generation, inspection and corrective retries. */
export const CHARACTER_TURNAROUND_LAYOUT_PROMPT = `one seamless ${CHARACTER_TURNAROUND_ASPECT_RATIO} horizontal canvas with exactly ${CHARACTER_TURNAROUND_FULL_BODY_VIEWS.length + 1} depictions of one identity in one continuous horizontal row: one large frontal identity close-up in the leftmost block, followed by exactly ${CHARACTER_TURNAROUND_FULL_BODY_VIEWS.length} equal-scale complete-subject views. The required angle sequence is ${CHARACTER_TURNAROUND_ANGLE_SEQUENCE}. Lock the complete-subject positions to this exact left-to-right contract: ${CHARACTER_TURNAROUND_SLOT_CONTRACT}. The close-up is separate and is not a full-body angle slot. Give the identity close-up roughly one quarter of the canvas width and space the complete-subject views clearly across the remaining width. Use spacing only, with no visible cell borders, divider lines or separate panel backgrounds. Preserve readable face, hair and wardrobe details instead of adding extra angles.`

function normalizeViewCount(value: number | undefined): number | undefined {
    return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : undefined
}

function normalizeDuplicateViewPairs(values: string[] | undefined, totalViewCount: number): Array<[number, number]> {
    const pairs = new Map<string, [number, number]>()
    for (const value of values ?? []) {
        const match = String(value)
            .trim()
            .match(/^(\d+)\s*[-–—]\s*(\d+)$/)
        if (!match) continue
        const first = Number(match[1])
        const second = Number(match[2])
        const left = Math.min(first, second)
        const right = Math.max(first, second)
        if (left < 1 || left === right || (totalViewCount > 0 && right > totalViewCount)) continue
        pairs.set(`${left}-${right}`, [left, right])
    }
    return [...pairs.values()].sort(([leftA, rightA], [leftB, rightB]) => leftA - leftB || rightA - rightB)
}

function countRedundantViews(pairs: Array<[number, number]>): number {
    const parents = new Map<number, number>()
    const find = (value: number): number => {
        const parent = parents.get(value) ?? value
        if (parent === value) return value
        const root = find(parent)
        parents.set(value, root)
        return root
    }
    for (const [left, right] of pairs) {
        if (!parents.has(left)) parents.set(left, left)
        if (!parents.has(right)) parents.set(right, right)
        const leftRoot = find(left)
        const rightRoot = find(right)
        if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot)
    }
    const roots = new Set([...parents.keys()].map(find))
    return Math.max(0, parents.size - roots.size)
}

/** Reconciles total count, distinct count and duplicate pairs conservatively. */
export function summarizeTurnaroundViews(quality: CharacterReferenceQualityFeedback): CharacterTurnaroundViewSummary {
    const canonicalViewCount = CHARACTER_TURNAROUND_FULL_BODY_VIEWS.filter(({ field }) => quality[field] === true).length
    const reportedTotal = normalizeViewCount(quality.fullBodyViewCount)
    const reportedDistinct = normalizeViewCount(quality.distinctFullBodyViewCount)
    const totalViewCount = reportedTotal ?? Math.max(canonicalViewCount, reportedDistinct ?? 0)
    const normalizedPairs = normalizeDuplicateViewPairs(quality.duplicateViewPairs, totalViewCount)
    const pairRedundantViewCount = countRedundantViews(normalizedPairs)
    const countMismatch = reportedDistinct !== undefined && reportedDistinct < totalViewCount
    const duplicateViewDetected = quality.duplicateViewDetected === true || normalizedPairs.length > 0 || countMismatch
    const redundantViewCount = Math.max(pairRedundantViewCount, duplicateViewDetected && totalViewCount > 0 ? 1 : 0)
    const maximumDistinctFromDuplicates = Math.max(0, totalViewCount - redundantViewCount)
    const distinctViewCount = Math.min(reportedDistinct ?? maximumDistinctFromDuplicates, totalViewCount, maximumDistinctFromDuplicates)

    return {
        totalViewCount,
        distinctViewCount,
        duplicateViewDetected,
        duplicateViewPairs: normalizedPairs.map(([left, right]) => `${left}-${right}`),
        redundantViewCount
    }
}

/** Preserve exact-slot inspection feedback so retries can repair the failed angle. */
export function filterTurnaroundInspectionIssues(issues: string[]): string[] {
    return issues.map(issue => issue.trim()).filter(Boolean)
}

/**
 * A newly generated turnaround sheet is accepted only when all four key views are
 * present, distinct and ordered. This keeps incomplete or duplicate view sets
 * from becoming downstream identity references.
 */
export function assessCharacterReferenceQuality(role: CharacterReferenceRetryRole, quality: CharacterReferenceQualityAssessment, hasBlockingText: boolean): CharacterReferenceQualityDecision {
    const viewSummary = summarizeTurnaroundViews(quality)
    const visibleFullBodyViews = viewSummary.distinctViewCount
    const duplicateViews = viewSummary.duplicateViewDetected

    if (role !== 'turnaround_sheet') {
        const strictFramingAccepted = role === 'face' ? quality.faceVisible : quality.fullBodyVisible && (role === 'back' || quality.faceVisible)
        const strictAccepted =
            !hasBlockingText &&
            quality.score >= 70 &&
            quality.singleCharacter &&
            quality.subjectTypeMatch !== false &&
            quality.identityReady &&
            quality.angleMatch &&
            quality.whiteBackground &&
            strictFramingAccepted
        return {
            hardRejected: !strictAccepted,
            strictAccepted,
            fallbackEligible: strictAccepted,
            candidateScore: quality.score,
            advisoryIssues: []
        }
    }

    const exactViewCount = viewSummary.totalViewCount === CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS
    const exactDistinctViewCount = visibleFullBodyViews === CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS
    const coreAccepted =
        !hasBlockingText &&
        quality.singleCharacter &&
        quality.subjectTypeMatch !== false &&
        quality.faceVisible &&
        quality.fullBodyVisible &&
        quality.identityReady &&
        quality.angleMatch &&
        quality.whiteBackground &&
        quality.faceCloseupVisible === true &&
        quality.identityConsistentAcrossViews === true &&
        CHARACTER_TURNAROUND_FULL_BODY_VIEWS.every(({ field }) => quality[field] === true) &&
        exactViewCount &&
        exactDistinctViewCount &&
        !duplicateViews
    const fallbackEligible =
        !hasBlockingText &&
        quality.singleCharacter &&
        quality.subjectTypeMatch !== false &&
        quality.faceVisible &&
        quality.fullBodyVisible &&
        quality.identityReady &&
        quality.whiteBackground &&
        quality.faceCloseupVisible === true &&
        quality.identityConsistentAcrossViews === true &&
        exactViewCount &&
        exactDistinctViewCount &&
        !duplicateViews
    const advisoryIssues = [
        quality.score < 70 ? (coreAccepted ? `综合评分 ${quality.score}，但已满足核心身份与视角门槛` : `综合评分 ${quality.score}，但主体身份与构图仍可用`) : '',
        fallbackEligible && !coreAccepted ? '物种、身份和四个独立全身视图正确，但角度顺序未完全达到严格模板' : ''
    ].filter(Boolean)
    const candidateScore =
        quality.score +
        visibleFullBodyViews * 5 +
        (quality.faceCloseupVisible ? 5 : 0) +
        (quality.fullBodyVisible ? 5 : 0) +
        (quality.angleMatch ? 3 : 0) +
        (quality.whiteBackground ? 2 : 0) -
        viewSummary.redundantViewCount * 8 -
        Math.max(0, viewSummary.totalViewCount - CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS) * 8

    return {
        hardRejected: !coreAccepted,
        strictAccepted: coreAccepted && advisoryIssues.length === 0,
        fallbackEligible,
        candidateScore,
        advisoryIssues
    }
}

const CHARACTER_TURNAROUND_SHEET_PROMPT_VERSION = 'character-reference/turnaround-sheet-v12@2026-09-14'
export const CHARACTER_REFERENCE_PROMPT_VERSION_MAX_LENGTH = 100

/** Describes stored images without guessing their layout from their filename. */
export function characterTurnaroundLayout(promptVersion: string | null | undefined): 'legacy' | 'compact' | 'unknown' {
    const version = Number(promptVersion?.match(/turnaround-sheet-v(\d+)(?:@|$)/)?.[1])
    if (version > 0 && version < 10) return 'legacy'
    return version === 10 || version === 11 || version === 12 ? 'compact' : 'unknown'
}

export function buildCharacterTurnaroundPromptVersion(basePromptVersion: string): string {
    const namespace = 'character-reference/'
    const turnaroundVersion =
        basePromptVersion.startsWith(namespace) && CHARACTER_TURNAROUND_SHEET_PROMPT_VERSION.startsWith(namespace)
            ? CHARACTER_TURNAROUND_SHEET_PROMPT_VERSION.slice(namespace.length)
            : CHARACTER_TURNAROUND_SHEET_PROMPT_VERSION
    const promptVersion = `${basePromptVersion}+${turnaroundVersion}`
    if (promptVersion.length > CHARACTER_REFERENCE_PROMPT_VERSION_MAX_LENGTH) {
        throw new Error(`角色参考图 promptVersion 超过 ${CHARACTER_REFERENCE_PROMPT_VERSION_MAX_LENGTH} 字符限制`)
    }
    return promptVersion
}

export const CHARACTER_SINGLE_SUBJECT_NEGATIVE = [
    'multiple people',
    'multiple characters',
    'duplicate person',
    'cloned body',
    'collage',
    'contact sheet',
    'split screen',
    'multi-panel layout',
    'character turnaround sheet',
    'multiple views',
    'cropped head',
    'cropped feet',
    'body outside frame',
    'scenery',
    'environment background',
    'room interior',
    'outdoor background',
    'architecture background',
    'background furniture',
    'set dressing',
    'colored background',
    'gradient background',
    'patterned background',
    'textured background'
].join(', ')

/** Multi-view sheets intentionally repeat one identity, so they need a separate negative channel. */
export const CHARACTER_TURNAROUND_SHEET_NEGATIVE = [
    'different characters',
    'different identities',
    'inconsistent face',
    'inconsistent hairstyle',
    'inconsistent body proportions',
    'inconsistent costume',
    `fewer than ${CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS} distinct full-body views`,
    `more than ${CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS} full-body views`,
    'duplicate camera angle',
    'incorrect camera-angle order',
    ...CHARACTER_TURNAROUND_FULL_BODY_VIEWS.map(view => `missing ${view.angle}-degree ${view.label} view`),
    'missing identity close-up',
    'cropped subject',
    'body outside frame',
    'action pose',
    'handheld prop',
    'scenery',
    'environment background',
    'colored background',
    'gradient background',
    'background shadow',
    'text',
    'typography',
    'written words',
    'letters',
    'numbers',
    'labels',
    'angle labels',
    'module labels',
    'annotations',
    'headers',
    'footer text',
    'measurement marks',
    'divider lines',
    'logo',
    'watermark'
].join(', ')

const REFERENCE_SHEET_TRANSIENT_SEGMENT =
    /(?:\b(?:film still|film grain|shallow depth of field|professional cinematography|dramatic backlight(?:ing)?|dramatic lighting|cinematic lighting|volumetric lighting|rim light(?:ing)?|red backlight(?:ing)?|blue backlight(?:ing)?|electric spark highlights?|cold shadows?|practical light|motion-ready|action pose|combat pose|aggressive posture|menacing stance|heroic stance|sinister expression|apartment corridor|street scene|room interior|outdoor background|environment background)\b|\b(?:carrying|holding|wielding|double-wielding)\b|电影感灯光|戏剧性灯光|戏剧性逆光|浅景深|胶片颗粒|体积光|轮廓光|公寓走廊|街道场景|室内背景|室外背景|环境背景|手持|拿着|挥舞|战斗姿势|攻击姿势|凶狠表情)/i

/** Remove shot-specific direction before an identity prompt is used as a neutral model sheet. */
export function sanitizeCharacterReferenceSheetPrompt(prompt: string | null | undefined): string {
    const source = prompt?.trim() ?? ''
    if (!source) return ''
    const stableSegments = source
        .split(/[,，;；\n]+/)
        .map(segment => segment.trim())
        .filter(Boolean)
        .filter(segment => !REFERENCE_SHEET_TRANSIENT_SEGMENT.test(segment))
    return stableSegments.join(', ')
}

export function characterReferenceSubjectProfile(prompt: string | null | undefined): CharacterReferenceSubjectProfile {
    const source = prompt?.toLowerCase() ?? ''
    if (
        /(?:quadruped|four[- ]legged|robotic (?:dog|hound|beast)|cybernetic (?:dog|hound)|\b(?:lion|lioness|tiger|leopard|panther|cheetah|dog|hound|canine|wolf|fox|bear|cat|feline|horse|deer|rabbit|hare|squirrel|hyena|warthog)\b|四足|机械犬|猎犬|雄狮|雌狮|狮子|猛虎|老虎|豹子|猎豹|狼|狐狸|熊|猫|犬|狗|马|鹿|兔|松鼠|鬣狗|疣猪)/i.test(
            source
        )
    )
        return 'quadruped'
    if (
        /(?:non[- ]humanoid|monster(?:ous)?|mutant|creature|titan|cyber[- ]?beast|bio[- ]?beast|fused with|merged (?:with|into)|tank treads?|tracked base|no lower legs|holographic spirit|\b(?:snake|serpent|cobra|python|scorpion|spider|insect|bird|avian|reptile|dolphin|whale|fish|turtle|dinosaur)\b|非人形|怪物|异形|变异|融合|履带|无下肢|全息灵体|蛇|蟒|眼镜蛇|蝎|蜘蛛|昆虫|鸟|禽|爬行动物|海豚|鲸|鱼|海龟|恐龙)/i.test(
            source
        )
    )
        return 'nonstandard_anatomy'
    if (/(?:face[- ]concealing|face completely concealed|full[- ]face (?:helmet|mask)|helmet completely concealing|facemask|masked face|全覆式头盔|完全遮住面部|面罩遮脸)/i.test(source))
        return 'concealed_head'
    return 'humanoid'
}

/** Returns a stable English species anchor when the character identity names an animal explicitly. */
export function characterReferenceAnimalSpecies(prompt: string | null | undefined): string | null {
    const source = prompt?.toLowerCase() ?? ''
    const species: Array<[RegExp, string]> = [
        [/(?:\blioness\b|雌狮)/i, 'lioness'],
        [/(?:\bmale lion\b|雄狮)/i, 'male lion'],
        [/(?:\blion\b|狮子|狮王)/i, 'lion'],
        [/(?:\btiger\b|猛虎|老虎)/i, 'tiger'],
        [/(?:\bleopard\b|豹子)/i, 'leopard'],
        [/(?:\bcheetah\b|猎豹)/i, 'cheetah'],
        [/(?:\bhyena\b|鬣狗)/i, 'hyena'],
        [/(?:\bwarthog\b|疣猪)/i, 'warthog'],
        [/(?:\bsquirrel\b|松鼠)/i, 'squirrel'],
        [/(?:\bwolf\b|灰狼|狼王|狼)/i, 'wolf'],
        [/(?:\bfox\b|狐狸)/i, 'fox'],
        [/(?:\bbear\b|棕熊|黑熊|白熊|熊)/i, 'bear'],
        [/(?:\brabbit\b|\bhare\b|兔子|兔)/i, 'rabbit'],
        [/(?:\bdog\b|\bhound\b|\bcanine\b|犬|狗)/i, 'dog'],
        [/(?:\bcat\b|\bfeline\b|猫)/i, 'cat'],
        [/(?:\bhorse\b|马)/i, 'horse'],
        [/(?:\bdeer\b|鹿)/i, 'deer'],
        [/(?:\bsnake\b|\bserpent\b|\bcobra\b|\bpython\b|毒蛇|眼镜蛇|蟒蛇|蛇)/i, 'snake'],
        [/(?:\bscorpion\b|巨蝎|毒蝎|蝎子|蝎)/i, 'scorpion'],
        [/(?:\bspider\b|蜘蛛)/i, 'spider'],
        [/(?:\bdolphin\b|海豚)/i, 'dolphin'],
        [/(?:\bwhale\b|鲸)/i, 'whale'],
        [/(?:\bturtle\b|海龟|乌龟)/i, 'turtle'],
        [/(?:\bdinosaur\b|恐龙)/i, 'dinosaur'],
        [/(?:\bhornbill\b|犀鸟)/i, 'hornbill'],
        [/(?:\bmeerkat\b|狐獴)/i, 'meerkat'],
        [/(?:\bbird\b|\bavian\b|鸟)/i, 'bird'],
        [/(?:\banimal\b|动物)/i, 'animal']
    ]
    return species.find(([pattern]) => pattern.test(source))?.[1] ?? null
}

const CHARACTER_WHITE_BACKGROUND_PROMPT =
    'isolated on a PURE WHITE (#FFFFFF) seamless studio background filling the entire canvas, no visible room, scenery, environment, landscape, architecture, furniture, set dressing, background objects, texture, gradient, pattern or colored backdrop; only a very subtle natural contact shadow directly beneath the subject is allowed'

export function characterReferenceFramingPrompt(role: CharacterReferenceRetryRole, subjectProfile: CharacterReferenceSubjectProfile = 'humanoid') {
    if (role === 'turnaround_sheet') {
        const closeupRequirement =
            subjectProfile === 'concealed_head'
                ? 'the leftmost identity block contains one large straight-on head-and-shoulders identity close-up of the exact helmet or mask; keep the face concealed and make the helmet silhouette, visor, sensors and materials clearly readable'
                : subjectProfile === 'quadruped'
                  ? 'the leftmost identity block contains one large straight-on head identity close-up with the species-specific muzzle, eyes, ears, sensors and markings clearly readable'
                  : subjectProfile === 'nonstandard_anatomy'
                    ? 'the leftmost identity block contains one large straight-on identity close-up of the head, skull, sensor cluster or other primary identity module, whichever defines this character'
                    : 'the leftmost identity block contains one large straight-on head-and-shoulders face close-up with a neutral eye-level gaze, relaxed closed mouth, clearly readable facial features, hair texture and neck accessories'
        const completeSubjectRequirement =
            subjectProfile === 'quadruped'
                ? 'each complete-subject view contains the entire head, torso, all legs and paws, and the full tail or rear silhouette with comfortable margin'
                : subjectProfile === 'nonstandard_anatomy'
                  ? 'each complete-subject view contains the entire character silhouette, including every limb plus any wheels, treads, fused base, tail, wings, tubes or mounted equipment, with comfortable margin; never invent human legs or feet'
                  : 'each full-body view shows the complete character from head to both feet with comfortable margin'
        return [
            'REFERENCE-SHEET RULES HAVE ABSOLUTE PRIORITY over cinematic lighting, depth of field, environment, action, expression and temporary handheld-prop wording from any other prompt or reference image',
            `production character turnaround presentation on ${CHARACTER_TURNAROUND_LAYOUT_PROMPT}`,
            closeupRequirement,
            'the front, left profile and rear views must be unambiguous; never mirror, reorder, skip or replace a slot; preserve asymmetric hair, clothing and accessories on their correct anatomical side instead of mirroring them',
            'all four directions must rotate the entire anatomy together and must be unmistakably different in head or identity module, torso or main chassis, hips or rear body, and feet, paws, wheels or treads; never substitute a gaze, arm or prop change for camera direction',
            completeSubjectRequirement,
            'all four complete-subject views use the same neutral standing or at-rest pose, the same scale and one consistent vertical baseline across the row',
            'identity consistency must be absolute across every depiction: identical face or head design, apparent age, anatomy, body proportions, skin or shell, hairstyle or helmet silhouette, costume or chassis construction, colors, materials, seams, accessories and footwear or support system; obey physically correct occlusion for each angle',
            'the layout directions are instructions only and must never appear as printed content; communicate the viewing directions only through the poses',
            'render absolutely no typography or written glyphs anywhere: no title, heading, module name, angle name, word, letter, number, annotation, caption, measurement mark, footer, logo, signature or watermark; no panel borders or divider lines',
            'omit temporary handheld props; retain permanently integrated equipment only when it is inseparable from the character silhouette; no action, story pose or exaggerated expression',
            'the entire uninterrupted canvas behind and beneath every depiction is flat pure white (#FFFFFF), with no cast shadow, contact shadow, floor horizon, color spill, scenery, decoration, texture, gradient or off-white area; flat neutral diffuse reference lighting; clean anti-aliased edges; high-resolution production model sheet'
        ].join(', ')
    }
    const singleImageLock =
        'EXACTLY ONE character only, one single uninterrupted full-canvas image, one camera view only, no other person, no duplicate of the subject, no collage, no panels, no split screen, no turnaround sheet'
    if (role === 'face') {
        return `${singleImageLock}, exact straight-on FRONT tight head-and-shoulders identity reference, neutral expression, both eyes equally visible, face centered and unobstructed, no side view, no three-quarter view, ${CHARACTER_WHITE_BACKGROUND_PROMPT}`
    }
    if (role === 'three_quarter_view') {
        return `${singleImageLock}, FULL-BODY 45-DEGREE THREE-QUARTER VIEW of the same character, entire head through both feet fully inside frame, torso hips and feet all rotated consistently about 45 degrees, both face identity and costume construction readable, neutral standing pose, not a front view, not a crop, ${CHARACTER_WHITE_BACKGROUND_PROMPT}`
    }
    if (role === 'profile') {
        return `${singleImageLock}, STRICT FULL-BODY 90-DEGREE LEFT-SIDE PROFILE VIEW of the same character, orthographic side elevation, the character's nose points toward image-right, camera exactly perpendicular to the body's side plane, entire head through both feet fully inside frame, exactly one eye and a clean nose silhouette visible, shoulders hips knees and both feet all consistently side-on, arms relaxed without covering the torso, neutral standing pose, rotate the whole body rather than only the head, no frontal torso, no three-quarter angle, ${CHARACTER_WHITE_BACKGROUND_PROMPT}`
    }
    if (role === 'back') {
        return `${singleImageLock}, EXACT FULL-BODY 180-DEGREE REAR VIEW of the same character, entire back of head through both feet fully inside frame, character facing directly away from camera, face completely hidden, preserve rear hairstyle silhouette and exact back construction colors and materials of every garment, neutral standing pose, no side glance, no turned face, ${CHARACTER_WHITE_BACKGROUND_PROMPT}`
    }
    return `${singleImageLock}, exact straight-on FRONT full-length casting reference, face torso hips knees and feet all facing camera symmetrically, neutral standing pose, the complete head, torso, both arms, both hands, both legs and both feet fully inside frame with comfortable margin, no side view, no three-quarter angle, ${CHARACTER_WHITE_BACKGROUND_PROMPT}`
}

export function characterReferenceRetryCorrection(role: CharacterReferenceRetryRole, quality: CharacterReferenceQualityFeedback, blockingRegions: string[] = []) {
    const inspectionIssues = role === 'turnaround_sheet' ? filterTurnaroundInspectionIssues(quality.issues) : quality.issues
    const issues = [...blockingRegions, ...inspectionIssues].map(value => value.trim()).filter(Boolean)
    const normalized = issues.join(' ').toLowerCase().replace(/_/g, ' ')
    if (role === 'turnaround_sheet') {
        const viewSummary = summarizeTurnaroundViews(quality)
        const visibleFullBodyViews = viewSummary.distinctViewCount
        const additionalViewsNeeded = Math.max(0, CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS - visibleFullBodyViews)
        const duplicateViewPairs = viewSummary.duplicateViewPairs
        const duplicateViews = viewSummary.duplicateViewDetected
        const failedSlotAssignments = CHARACTER_TURNAROUND_FULL_BODY_VIEWS.flatMap((view, index) =>
            quality[view.field] === true ? [] : [`slot ${index + 1} must be rebuilt as an unambiguous ${view.angle}° ${view.label} complete-subject view`]
        )
        const duplicateSlotNumbers = new Set<number>()
        for (const pair of duplicateViewPairs) {
            for (const value of pair.split('-').map(Number)) {
                if (Number.isInteger(value) && value >= 1 && value <= CHARACTER_TURNAROUND_FULL_BODY_VIEWS.length) duplicateSlotNumbers.add(value)
            }
        }
        const duplicateSlotAssignments = [...duplicateSlotNumbers]
            .sort((left, right) => left - right)
            .map(slotNumber => {
                const view = CHARACTER_TURNAROUND_FULL_BODY_VIEWS[slotNumber - 1]
                return `slot ${slotNumber}=${view.angle}° ${view.label}`
            })
        return [
            `REGENERATION REQUIRED. The previous character sheet failed quality inspection: ${issues.join('; ') || 'turnaround coverage or identity consistency failed'}. Discard it and rebuild the complete sheet.`,
            quality.subjectTypeMatch === false
                ? 'The rendered subject type is wrong. Rebuild the requested species and anatomy exactly; remove every human face, human body, human skin, human hairstyle and human wardrobe when the identity is an animal.'
                : null,
            `NON-NEGOTIABLE FULL-BODY SLOT CONTRACT: ${CHARACTER_TURNAROUND_SLOT_CONTRACT}. Count from left to right after the unnumbered identity close-up. Do not infer, mirror, swap or choose alternative angles.`,
            !quality.faceCloseupVisible ? 'Restore one large frontal identity close-up of the face, helmet, mask, head or primary sensor module in the leftmost identity block.' : null,
            failedSlotAssignments.length
                ? `Repair these exact failed positions: ${failedSlotAssignments.join('; ')}. Preserve the assigned slots that already passed, but regenerate the complete sheet as one coherent image.`
                : null,
            additionalViewsNeeded > 0
                ? `Restore ${additionalViewsNeeded} missing distinct full-body angle slot${additionalViewsNeeded === 1 ? '' : 's'} so the sheet contains exactly ${CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS} different views in the required ${CHARACTER_TURNAROUND_ANGLE_SEQUENCE} sequence.`
                : null,
            viewSummary.totalViewCount > CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS
                ? `Remove ${viewSummary.totalViewCount - CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS} extra full-body slot${viewSummary.totalViewCount - CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS === 1 ? '' : 's'} while preserving the required ${CHARACTER_TURNAROUND_ANGLE_SEQUENCE} views.`
                : null,
            duplicateViews
                ? `The previous duplicate or near-duplicate pair${duplicateViewPairs.length === 1 ? ' was' : 's were'}${duplicateViewPairs.length ? ` ${duplicateViewPairs.join(', ')}` : ' detected'}. Rebuild every implicated position to its own assignment${duplicateSlotAssignments.length ? ` (${duplicateSlotAssignments.join('; ')})` : ` from ${CHARACTER_TURNAROUND_SLOT_CONTRACT}`}. A changed gaze, arm pose or prop position does not create a new angle; rotate the head, torso, hips and feet together.`
                : null,
            !quality.identityConsistentAcrossViews || !quality.singleCharacter || /different|inconsistent|identity|costume|hair/.test(normalized)
                ? 'Every depiction must be the exact same character: identical face, hair, anatomy, proportions, skin, clothing construction, colors, materials, accessories and footwear.'
                : null,
            !quality.fullBodyVisible || /crop|feet|foot|paw|wheel|tread|partial body|cut off/.test(normalized)
                ? 'Pull back every complete-subject view so the whole real anatomy and support system—including limbs, feet, paws, wheels, treads, tail, wings or fused base where applicable—remains inside the canvas with clear margin.'
                : null,
            !quality.whiteBackground || /background|shadow|backdrop|scenery|gradient|pattern|texture/.test(normalized)
                ? 'Replace the entire canvas with uniform pure white (#FFFFFF), including behind and beneath every view; remove all shadows, scenery, gradients, textures, labels and borders.'
                : null,
            `Rebuild ${CHARACTER_TURNAROUND_LAYOUT_PROMPT} The angles are placement instructions only; do not print their slot numbers or degree labels. Use the real anatomy and support system of this subject; never invent a human face, legs or feet for a helmeted, quadruped, wheeled, tracked or fused-body design. Keep the entire canvas pure white (#FFFFFF) with no shadow. Remove every title, heading, word, letter, number, angle marker, module name, annotation, caption, measurement mark, footer, logo, watermark, border and divider line. Omit temporary handheld props and use no action pose.`
        ]
            .filter(Boolean)
            .join(' ')
    }
    const corrections = [
        `REGENERATION REQUIRED. The previous candidate failed quality inspection: ${issues.join('; ') || 'identity or composition gate failed'}. Discard its composition and create a new image.`,
        'Return exactly one character in one uninterrupted image with one camera view. Never create a collage, contact sheet, split screen, multiple panels, turnaround sheet, before-and-after comparison, duplicate body, crowd, companion, reflection, poster layout or inset portrait.'
    ]
    if (!quality.singleCharacter || /multiple|duplicate|collage|contact sheet|split screen|panel|crowd/.test(normalized)) {
        corrections.push('There must be exactly one visible subject total. Remove every second figure, duplicate, inset view, reflection and background person.')
    }
    if (quality.subjectTypeMatch === false) {
        corrections.push('The subject type is wrong. Rebuild the requested species and anatomy exactly; never substitute a human or generic humanoid for an animal or non-human identity.')
    }
    if (role !== 'face' && (!quality.fullBodyVisible || /crop|feet|foot|partial body|cut off/.test(normalized))) {
        corrections.push(
            'Pull the camera farther back. Show the subject from the top of the head through the soles of both feet, with empty margin above the head and below both feet; no body part may touch or leave the frame.'
        )
    }
    if (role !== 'back' && !quality.faceVisible) {
        corrections.push('Keep one unobstructed, recognizable face clearly visible and large enough to verify identity.')
    }
    if (!quality.angleMatch) {
        if (role === 'full_body')
            corrections.push('Use an exact straight-on front view: face, torso, hips, knees and both feet all point directly toward the camera; no side or three-quarter rotation.')
        if (role === 'face') corrections.push('Use an exact straight-on frontal face: both eyes equally visible and facial centerline facing the camera; no profile or three-quarter rotation.')
        if (role === 'three_quarter_view')
            corrections.push(
                'Rotate the entire character consistently to a clear 45-degree three-quarter viewing angle while keeping the complete body visible; this is an angle change, never a medium-shot crop.'
            )
        if (role === 'profile')
            corrections.push(
                "Use an orthographic 90-degree left-side elevation: the character's nose points toward image-right, the camera is perpendicular to the body's side plane, exactly one eye and a clean nose silhouette are visible, and shoulders, hips, knees and both feet are all side-on. Rotate the whole body, not only the head; no frontal torso or three-quarter pose."
            )
        if (role === 'back')
            corrections.push('Use an exact 180-degree rear view: the character faces directly away, the face is completely hidden, and the back of hair and every garment is clearly visible.')
    }
    if (!quality.whiteBackground || /background|backdrop|scenery|environment|room|landscape|architecture|furniture|gradient|pattern|texture/.test(normalized)) {
        corrections.push(
            'Replace the entire background with uniform pure white (#FFFFFF). Remove all scenery, rooms, landscapes, architecture, furniture, set dressing, background objects, textures, gradients, patterns and colored areas; allow only a very subtle natural contact shadow directly beneath the subject.'
        )
    }
    if (!quality.identityReady || /non-human|wrong subject|species|mascot|statue|object/.test(normalized)) {
        corrections.push(
            'The subject type, species, face, age and body identity must exactly match the supplied identity description/reference; do not replace it with a mascot, statue, object, creature or unrelated subject.'
        )
    }
    return corrections.join(' ')
}
