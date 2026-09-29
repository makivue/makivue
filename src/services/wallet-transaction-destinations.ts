import { prisma } from '@/lib/prisma'
import { parseApiId } from '@/lib/api-id'

type Source = { type: string; sourceType: string | null; sourceId: string | null }

// Resolve a page of ledger sources in batches. Never treat a provider/job ID as a project ID.
export async function walletTransactionDestinations(userId: bigint, transactions: Source[]) {
    const destinations = new Map<string, string>()
    const sources = transactions.filter(row => row.type === 'usage' && row.sourceType && row.sourceId)
    const idsFor = (...types: string[]) => [
        ...new Set(
            sources
                .filter(row => types.includes(row.sourceType!))
                .map(row => parseApiId(row.sourceId))
                .filter((id): id is bigint => id !== null)
        )
    ]
    const put = (type: string, id: bigint | string, path: string) => destinations.set(`${type}:${id}`, path)
    const ownedProject = { userId, deletedAt: null }
    const ownedEpisode = { deletedAt: null, project: ownedProject }
    const ownedStoryboard = { deletedAt: null, episode: ownedEpisode }
    const episodePath = (episode: { id: bigint; projectId: bigint }) => `/projects/${episode.projectId}/episodes/${episode.id}`

    const generationIds = idsFor('generation')
    if (generationIds.length) {
        const rows = await prisma.generation.findMany({
            where: { id: { in: generationIds }, storyboard: ownedStoryboard },
            select: { id: true, storyboard: { select: { id: true, episode: { select: { id: true, projectId: true } } } } }
        })
        for (const row of rows) put('generation', row.id, `${episodePath(row.storyboard.episode)}#shot-${row.storyboard.id}`)
    }

    const creatorIds = idsFor('creator_image', 'creator_video')
    if (creatorIds.length) {
        const rows = await prisma.creatorAsset.findMany({ where: { userId, deletedAt: null, sourceJobId: { in: creatorIds } }, select: { id: true, sourceJobId: true, type: true } })
        for (const row of rows) if (row.sourceJobId !== null) put(`creator_${row.type}`, row.sourceJobId, `/ai${row.type}?assetId=${row.id}`)
    }

    const mergeIds = idsFor('video_merge')
    if (mergeIds.length) {
        const rows = await prisma.videoMerge.findMany({ where: { id: { in: mergeIds }, episode: ownedEpisode }, select: { id: true, episode: { select: { id: true, projectId: true } } } })
        for (const row of rows) put('video_merge', row.id, `${episodePath(row.episode)}#episode-finished`)
    }

    const referenceIds = idsFor('reference_job')
    if (referenceIds.length) {
        const rows = await prisma.refImageJob.findMany({ where: { id: { in: referenceIds } }, select: { id: true, projectId: true, targetType: true } })
        const projects = await prisma.project.findMany({ where: { ...ownedProject, id: { in: rows.map(row => row.projectId) } }, select: { id: true } })
        const owned = new Set(projects.map(project => project.id))
        for (const row of rows) if (owned.has(row.projectId)) put('reference_job', row.id, `/projects/${row.projectId}?tab=${row.targetType === 'character' ? 'characters' : 'scenes'}`)
    }

    const llmIds = idsFor('llm_job')
    const projectSources = sources.flatMap(row => {
        const match =
            row.sourceType === 'project_style_reference' ? row.sourceId?.match(/^project-style:(\d+)$/) : row.sourceType === 'llm_job' ? row.sourceId?.match(/^(?:story-directions:)?(\d+)$/) : null
        const id = parseApiId(match?.[1])
        return id === null ? [] : [{ row, id }]
    })
    if (projectSources.length) {
        const jobs = await prisma.projectAiJob.findMany({ where: { id: { in: projectSources.map(source => source.id) } }, select: { id: true, projectId: true } })
        const projects = await prisma.project.findMany({ where: { ...ownedProject, id: { in: jobs.map(job => job.projectId) } }, select: { id: true } })
        const owned = new Set(projects.map(project => project.id))
        for (const source of projectSources) {
            const job = jobs.find(job => job.id === source.id && owned.has(job.projectId))
            if (job) put(source.row.sourceType!, source.row.sourceId!, `/projects/${job.projectId}?tab=novel`)
        }
    }
    if (llmIds.length) {
        const [outlines, extracts, chapters, scripts, storyboards] = await Promise.all([
            prisma.outlineJob.findMany({ where: { id: { in: llmIds }, project: ownedProject }, select: { id: true, projectId: true } }),
            prisma.extractJob.findMany({ where: { id: { in: llmIds }, project: ownedProject }, select: { id: true, projectId: true } }),
            prisma.chapterJob.findMany({ where: { id: { in: llmIds }, episode: ownedEpisode }, select: { id: true, episode: { select: { id: true, projectId: true } } } }),
            prisma.scriptJob.findMany({ where: { id: { in: llmIds }, episode: ownedEpisode }, select: { id: true, episode: { select: { id: true, projectId: true } } } }),
            prisma.storyboardJob.findMany({ where: { id: { in: llmIds }, episode: ownedEpisode }, select: { id: true, episode: { select: { id: true, projectId: true } } } })
        ])
        for (const row of outlines) put('llm_job', row.id, `/projects/${row.projectId}?tab=episodes`)
        for (const row of extracts) put('llm_job', row.id, `/projects/${row.projectId}?tab=characters`)
        for (const row of [...chapters, ...scripts]) put('llm_job', row.id, `${episodePath(row.episode)}#episode-script`)
        for (const row of storyboards) put('llm_job', row.id, `${episodePath(row.episode)}#production-overview`)
    }

    const episodeSources = sources.flatMap(row => {
        const match = row.sourceType === 'llm_job' ? row.sourceId?.match(/^\d+:(\d+)$/) : null
        const id = parseApiId(match?.[1])
        return id === null ? [] : [{ row, id }]
    })
    if (episodeSources.length) {
        const episodes = await prisma.episode.findMany({ where: { ...ownedEpisode, id: { in: episodeSources.map(source => source.id) } }, select: { id: true, projectId: true } })
        for (const source of episodeSources) {
            const episode = episodes.find(episode => episode.id === source.id)
            if (episode) put('llm_job', source.row.sourceId!, `${episodePath(episode)}#episode-script`)
        }
    }
    return destinations
}
