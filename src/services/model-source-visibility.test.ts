import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IMAGE_PROVIDER_CAPABILITIES, VIDEO_PROVIDER_CAPABILITIES } from '@/lib/provider-capabilities'
import { generationModelSource } from '@/lib/model-display'
import { TEXT_MODEL_OPTIONS } from '@/lib/text-model-options'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('global model source visibility', () => {
    it('classifies every selectable text, image and video model', () => {
        const modelIds = [...TEXT_MODEL_OPTIONS.map(option => option.value), ...Object.keys(IMAGE_PROVIDER_CAPABILITIES), ...Object.keys(VIDEO_PROVIDER_CAPABILITIES)]
        for (const modelId of modelIds) expect(generationModelSource(modelId), modelId).not.toBeNull()
    })

    it('groups models under one source heading in every shared custom select', () => {
        const customSelect = source('src/components/CustomSelect.tsx')
        expect(customSelect).toContain('GENERATION_MODEL_SOURCES.map(source =>')
        expect(customSelect).toContain('name: t(GENERATION_MODEL_SOURCE_LABELS[source])')
        expect(customSelect).toContain('options: filtered.filter(option => generationModelSource(option.value) === source)')
        expect(customSelect).toContain('!generationModelSource(option.value) && option.description')
        expect(customSelect).not.toContain('font-medium uppercase tracking-wider text-gray-500')
        expect(customSelect).not.toContain('GENERATION_MODEL_SOURCE_LABELS[selectedSource]')
        expect(customSelect).not.toContain('<ModelSourceBadge')
    })

    it('uses the same grouped layout in model-specific controls', () => {
        const switcher = source('src/components/ModelSwitcher.tsx')
        const settings = source('src/app/settings/page.tsx')
        const episode = source('src/app/projects/[id]/episodes/[episodeId]/page.tsx')
        expect(switcher).toContain('SOURCES.map(source =>')
        expect(switcher).not.toContain('<ModelSourceBadge')
        expect(settings).toContain('GENERATION_MODEL_SOURCES.map(source =>')
        expect(settings).toContain('IMAGE_PROVIDERS.filter(provider => generationModelSource(provider.value) === source)')
        expect(settings).toContain('OPENAI_MODEL_PRESETS.filter(model => model.source === source)')
        expect(settings).not.toContain('{p.desc}')
        expect(settings).not.toContain('{m.desc}')
        expect(settings).not.toContain('font-medium uppercase tracking-wider text-gray-500')
        expect(episode).toContain('const optionGroups = GENERATION_MODEL_SOURCES.map(source =>')
        expect(episode).toContain('optionGroups.map(group =>')
        expect(episode).not.toContain('GENERATION_MODEL_SOURCE_LABELS[selectedSource]')
        expect(episode).not.toContain('{option.description}')
        expect(episode).not.toContain('font-medium uppercase tracking-wider text-gray-500')
    })

    it('puts the source before the model in standalone status displays', () => {
        expect(source('src/components/GenerationFailureNotice.tsx')).toContain('<ModelSourceBadge model={provider} />')
        expect(source('src/app/projects/[id]/ProductionInsightsPanel.tsx')).toContain('<ModelSourceBadge model={group.provider} />')
    })
})
