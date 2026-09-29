import { prisma } from './prisma'

/**
 * Ownership guard: resolves the owning userId for a given resource id and
 * checks it matches the caller. Returns null on success, or a Response the
 * caller should return unchanged (404 if not found, 403 if not owned).
 */
export async function assertProjectOwner(projectId: bigint, callerUserId: bigint): Promise<Response | null> {
    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { userId: true }
    })
    if (!project) return notFound('project')
    if (project.userId !== callerUserId) return forbidden()
    return null
}

export async function assertEpisodeOwner(episodeId: bigint, callerUserId: bigint): Promise<Response | null> {
    const episode = await prisma.episode.findFirst({
        where: { id: episodeId, deletedAt: null },
        select: { project: { select: { userId: true } } }
    })
    if (!episode) return notFound('episode')
    if (episode.project.userId !== callerUserId) return forbidden()
    return null
}

export async function assertStoryboardOwner(storyboardId: bigint, callerUserId: bigint): Promise<Response | null> {
    const sb = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        select: { episode: { select: { project: { select: { userId: true } } } } }
    })
    if (!sb) return notFound('storyboard')
    if (sb.episode.project.userId !== callerUserId) return forbidden()
    return null
}

export async function assertCharacterOwner(characterId: bigint, callerUserId: bigint): Promise<Response | null> {
    const c = await prisma.character.findFirst({
        where: { id: characterId, deletedAt: null },
        select: { project: { select: { userId: true } } }
    })
    if (!c) return notFound('character')
    if (c.project.userId !== callerUserId) return forbidden()
    return null
}

export async function assertSceneOwner(sceneId: bigint, callerUserId: bigint): Promise<Response | null> {
    const s = await prisma.scene.findFirst({
        where: { id: sceneId, deletedAt: null },
        select: { project: { select: { userId: true } } }
    })
    if (!s) return notFound('scene')
    if (s.project.userId !== callerUserId) return forbidden()
    return null
}

function forbidden(): Response {
    return jsonError('forbidden', 403)
}

function notFound(what: string): Response {
    return jsonError(`${what} not found`, 404)
}

function jsonError(message: string, status: number): Response {
    return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    })
}
