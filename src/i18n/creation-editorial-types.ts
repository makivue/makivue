import type { CreationGuide } from './creation-guides'
import type { GuideSlug } from './creation-guide-config'
import type { CreationTool } from './creation-tools'
import type { ToolSlug } from './creation-tool-config'

export type EditorialEdition = {
    guideIndex: Record<
        'title' | 'description' | 'heading' | 'intro' | 'label' | 'contents' | 'example' | 'faq' | 'related' | 'feature' | 'action' | 'pricing' | 'walkthrough' | 'credits' | 'updated' | 'byline',
        string
    >
    toolIndex: Record<
        | 'title'
        | 'description'
        | 'heading'
        | 'intro'
        | 'label'
        | 'features'
        | 'steps'
        | 'useCases'
        | 'example'
        | 'faq'
        | 'related'
        | 'action'
        | 'pricing'
        | 'guide'
        | 'videoTool'
        | 'dramaTool'
        | 'credits'
        | 'compare',
        string
    >
    guides: Record<GuideSlug, Omit<CreationGuide, 'feature' | 'action'>>
    tools: Record<ToolSlug, Omit<CreationTool, 'action' | 'guide' | 'feature' | 'related'>>
}
