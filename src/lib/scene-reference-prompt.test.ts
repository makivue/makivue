import { describe, expect, it } from 'vitest'
import { getVisualStyle, getVisualStyleProfile } from './novel'
import { buildSceneReferenceGenerationPrompt } from './scene-reference-prompt'

function build(scene: { name: string; description?: string; locationPrompt?: string | null; timeOfDay?: string }) {
    const style = getVisualStyle('cyberpunk')
    return buildSceneReferenceGenerationPrompt({
        scene,
        style,
        styleProfile: getVisualStyleProfile('cyberpunk'),
        broadScene: true,
        aspectRatio: '16:9',
        hasStyleReference: true,
        generationNonce: 'fresh-1'
    })
}

describe('scene reference prompt hierarchy', () => {
    it('keeps cliff-road geography above generic cyberpunk scenery', () => {
        const result = build({
            name: '喀尔巴阡山脉绝壁公路',
            description: '一条沿巨大岩壁盘旋、俯瞰深谷的危险山路',
            locationPrompt: 'narrow switchback road carved into a sheer Carpathian cliff, abyss below, exposed rock and guardrails',
            timeOfDay: 'stormy dusk'
        })

        expect(result.prompt).toContain('LOCATION IDENTITY HAS HIGHER PRIORITY')
        expect(result.prompt).toContain('MOUNTAIN ROAD GEOGRAPHY')
        expect(result.prompt).toContain('赛博霓虹')
        expect(result.prompt).toContain('signature colors as controlled motivated accents')
        expect(result.prompt).not.toContain('neon city lights')
        expect(result.negativePrompt).toContain('tunnel replacing the open mountain road')
        expect(result.negativePrompt).toContain('generic neon alley')
    })

    it('protects the scale and function of a government underground garage', () => {
        const result = build({
            name: '国会大厦南侧地下车库',
            description: '国会建筑下方的大型安保车库，通往礼宾后台',
            locationPrompt: 'secure underground parking facility with multiple ramps and formal access control'
        })

        expect(result.prompt).toContain('LARGE UNDERGROUND VEHICULAR SPACE')
        expect(result.prompt).toContain('MONUMENTAL CIVIC INSTITUTION')
        expect(result.prompt).toContain('multiple drive lanes and parking bays')
        expect(result.negativePrompt).toContain('narrow hallway')
        expect(result.negativePrompt).toContain('low-budget office')
    })

    it('treats a style reference as visual treatment rather than a location template', () => {
        const result = build({
            name: '国会大厦地下交接仪式后台',
            locationPrompt: 'secure ceremonial backstage and holding area connected to the main chamber'
        })

        expect(result.prompt).toContain('CEREMONIAL BACKSTAGE FUNCTION')
        expect(result.prompt).toContain('use the supplied image only for rendering medium')
        expect(result.prompt).toContain('Do not copy its location, architecture, layout, camera position')
    })

    it('still produces a useful identity prompt when the editable location prompt is empty', () => {
        const result = build({
            name: '国会大厦南侧地下车库',
            description: '国会建筑下方的大型安保车库',
            locationPrompt: null
        })

        expect(result.prompt).toContain('exact named location: 国会大厦南侧地下车库')
        expect(result.prompt).toContain('LARGE UNDERGROUND VEHICULAR SPACE')
        expect(result.prompt).not.toContain('location design details:')
    })
})
