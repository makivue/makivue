import { prisma } from '@/lib/prisma'
import { classifyStoryboardContinuity } from '@/lib/storyboard-continuity'

/**
 * Reclassifies legacy storyboards before generation so projects created before
 * the stateful continuity layer can benefit without recreating their scripts.
 * Existing continuous/seamless decisions remain explicit inputs to the
 * classifier; scene/time breaks still force an independent shot.
 */
export async function refreshEpisodeStoryboardContinuity(episodeId: bigint) {
    const shots = await prisma.storyboard.findMany({
        where: { episodeId, deletedAt: null },
        orderBy: { order: 'asc' },
        select: {
            id: true,
            order: true,
            sceneId: true,
            actionDesc: true,
            imagePrompt: true,
            continuityMode: true,
            continuityGroup: true,
            continuityReason: true,
            scene: { select: { name: true, timeOfDay: true } },
            characters: { select: { character: { select: { name: true } } } }
        }
    })
    if (shots.length < 2) return 0

    const classified = classifyStoryboardContinuity(
        shots.map(shot => ({
            id: shot.id,
            order: shot.order,
            sceneId: shot.sceneId,
            sceneName: shot.scene?.name ?? null,
            sceneTimeOfDay: shot.scene?.timeOfDay ?? null,
            characterNames: shot.characters.map(item => item.character.name),
            actionDesc: shot.actionDesc,
            imagePrompt: shot.imagePrompt,
            continuityMode: shot.continuityMode,
            continuityGroup: shot.continuityGroup,
            continuityReason: shot.continuityReason
        }))
    )
    const originalById = new Map(shots.map(shot => [shot.id, shot]))
    const changed = classified.filter(shot => {
        const original = originalById.get(shot.id)
        return !!original && (original.continuityMode !== shot.continuityMode || original.continuityGroup !== shot.continuityGroup || original.continuityReason !== shot.continuityReason)
    })
    if (changed.length === 0) return 0

    // This migration is idempotent compatibility cleanup, not an all-or-nothing
    // business write. Group identical patches into short updateMany statements
    // instead of opening a 5-second transaction with one UPDATE per storyboard.
    // Concurrent episode GETs can safely repeat any unfinished group.
    const updateGroups = new Map<
        string,
        {
            ids: bigint[]
            continuityMode: (typeof changed)[number]['continuityMode']
            continuityGroup: number | null
            continuityReason: string | null
        }
    >()
    for (const shot of changed) {
        const key = JSON.stringify([shot.continuityMode, shot.continuityGroup, shot.continuityReason])
        const group = updateGroups.get(key)
        if (group) {
            group.ids.push(shot.id)
        } else {
            updateGroups.set(key, {
                ids: [shot.id],
                continuityMode: shot.continuityMode,
                continuityGroup: shot.continuityGroup,
                continuityReason: shot.continuityReason
            })
        }
    }
    await Promise.all(
        [...updateGroups.values()].map(group =>
            prisma.storyboard.updateMany({
                where: { id: { in: group.ids }, episodeId, deletedAt: null },
                data: {
                    continuityMode: group.continuityMode,
                    continuityGroup: group.continuityGroup,
                    continuityReason: group.continuityReason
                }
            })
        )
    )
    return changed.length
}
