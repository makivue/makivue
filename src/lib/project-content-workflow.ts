import type { NovelSetup } from './novel'
import { isScriptGenerated } from './chapter-progress'

export type ImportedContentStage = 'outline' | 'novel' | 'script' | 'storyboard'

type WorkflowProject = {
    novelStage?: string | null
    novelSetup?: string | null
    episodes?: readonly {
        status?: string | null
        hasScript?: boolean
        script?: string | null
        synopsis?: string | null
        _count?: { storyboards: number }
    }[]
}

/** The imported source is the workflow entry point, not proof of completed upstream work. */
export function getProjectContentWorkflow(project: WorkflowProject | null | undefined) {
    let source: ImportedContentStage | null = null
    try {
        const setup = JSON.parse(project?.novelSetup || '{}') as NovelSetup & { importedContentStage?: ImportedContentStage }
        if (['outline', 'novel', 'script', 'storyboard'].includes(setup.importedContentStage ?? '')) source = setup.importedContentStage!
        else if (setup.fieldSources?.episodeStatePlan === 'derived_from_import') {
            // Imports created before source provenance was stored still have this marker.
            // Keep any real outline available when an older import later advanced.
            if (project?.episodes?.some(episode => episode.synopsis?.trim())) source = 'outline'
            else if (project?.episodes?.some(episode => (episode._count?.storyboards ?? 0) > 0)) source = 'storyboard'
            else if (project?.episodes?.some(episode => episode.hasScript || episode.script?.trim() || isScriptGenerated(episode.status))) source = 'script'
            else source = project?.novelStage === 'outlined' ? 'outline' : 'novel'
        }
    } catch {
        // Malformed legacy setup must not prevent opening the project.
    }
    // A deliberate reset restores the creation flow. An unsegmented novel still
    // needs the source-based planning flow before it has editable chapters.
    if (project?.novelStage === 'setup' || project?.novelStage === 'needs_split') source = null
    if (source === 'novel' && project?.novelStage === 'outlined') source = null
    if ((source === 'script' || source === 'storyboard') && ['outlined', 'drafting'].includes(project?.novelStage ?? '')) source = null
    const importedScript = source === 'script' || source === 'storyboard'
    const firstStage = importedScript ? 'finalized' : source === 'novel' ? 'drafting' : source === 'outline' ? 'outlined' : 'setup'
    return { source, importedScript, firstStage }
}

export function resolveProjectWritingStage(project: WorkflowProject | null | undefined, requestedStage: string) {
    const stages = ['setup', 'outlined', 'drafting', 'finalized']
    const { firstStage } = getProjectContentWorkflow(project)
    return stages[Math.max(stages.indexOf(firstStage), stages.indexOf(requestedStage))]
}
