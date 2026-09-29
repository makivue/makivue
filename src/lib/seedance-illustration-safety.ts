export interface SeedanceIllustrationSafety {
    positive: string
    negative: string
}

const SEEDANCE_VIRTUAL_CHARACTER_POSITIVE =
    'SEEDANCE VIRTUAL CHARACTER SAFETY LOCK: every depicted human must be an original fictional virtual actor designed only for this project. ' +
    'Do not recreate, reference, or resemble any real individual, celebrity, public figure, influencer, or recognizable identity. ' +
    'Keep the selected project art style, character age, wardrobe, pose, expression, composition, lighting, and story continuity. ' +
    'For realistic styles, retain premium cinematic quality while using a visibly designed digital-actor face and subtly synthetic, art-directed skin detail instead of biometric camera realism. ' +
    'The result must read as a fictional production still, never a real-person photo, documentary image, candid shot, selfie, passport photo, ID photo, surveillance frame, news photo, or social-media photo.'

const SEEDANCE_VIRTUAL_CHARACTER_NEGATIVE =
    'real person likeness, celebrity likeness, public figure likeness, influencer likeness, recognizable real individual, biometric facial realism, ' +
    'passport photo, ID photo, selfie, candid photograph, surveillance image, documentary photograph, news photograph, social-media photograph'

export function getSeedanceIllustrationSafety(
    videoProvider: ProductionVideoProvider | undefined,
    hasVisibleCharacters: boolean
): SeedanceIllustrationSafety | null {
    if ((videoProvider !== 'seedance' && videoProvider !== 'seedance25') || !hasVisibleCharacters) return null
    return {
        positive: SEEDANCE_VIRTUAL_CHARACTER_POSITIVE,
        negative: SEEDANCE_VIRTUAL_CHARACTER_NEGATIVE
    }
}
import type { ProductionVideoProvider } from './provider-capabilities'
