import { describe, expect, it } from 'vitest'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { isAzureDeploymentNotFound, normalizeTextModel, STABLE_GPT_TEXT_MODEL } from './llm'

describe('image safety prompt rewrite', () => {
    it('maps the unavailable legacy deployment to the stable GPT text deployment', () => {
        expect(normalizeTextModel('gpt-5.6-shortdrama')).toBe(STABLE_GPT_TEXT_MODEL)
        expect(normalizeTextModel('gpt-5.5-shortdrama')).toBe('gpt-5.5-shortdrama')
        expect(normalizeTextModel('gemini:gemini-3.1-pro-preview')).toBe(GEMINI_FLASH_TEXT_MODEL_ID)
    })

    it('detects a missing Azure deployment so the rewrite can use the configured model', () => {
        expect(isAzureDeploymentNotFound(new Error('Azure Responses API error: {"code":"DeploymentNotFound"}'))).toBe(true)
        expect(isAzureDeploymentNotFound(new Error('Gemini safety filter'))).toBe(false)
    })
})
