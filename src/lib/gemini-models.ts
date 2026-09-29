/**
 * Shared Google model identifiers.
 *
 * Keep these values free of server-only code so the settings UI and server
 * generation paths can use the same source of truth.
 */
export const GEMINI_FLASH_TEXT_MODEL = 'gemini-3.7-flash'
export const GEMINI_FLASH_TEXT_MODEL_ID = `gemini:${GEMINI_FLASH_TEXT_MODEL}`
export const LEGACY_GEMINI_PRO_TEXT_MODEL_ID = 'gemini:gemini-3.1-pro-preview'
export const LEGACY_GEMINI_FLASH_TEXT_MODEL_ID = 'gemini:gemini-3.5-flash'
export const LEGACY_GEMINI_FLASH_LITE_TEXT_MODEL_ID = 'gemini:gemini-3.1-flash-lite-preview'
export const REMOVED_GEMINI_25_PRO_TEXT_MODEL_ID = 'gemini:gemini-2.5-pro'
export const REMOVED_GEMINI_25_FLASH_TEXT_MODEL_ID = 'gemini:gemini-2.5-flash'
export const REMOVED_GEMINI_36_FLASH_TEXT_MODEL_ID = 'gemini:gemini-3.6-flash'
export const REMOVED_GEMINI_FLASH_LITE_TEXT_MODEL_ID = 'gemini:gemini-3.1-flash-lite'

export const NANO_BANANA_IMAGE_MODEL = 'gemini-3.1-flash-image'
// This is an internal multimodal inspector, not a user-selectable text model.
export const NANO_BANANA_VISION_MODEL = 'gemini-2.5-pro'
export const NANO_BANANA_LOCATION = 'global'
