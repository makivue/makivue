import type { Prisma } from '@/generated/prisma/client'
import { markProjectVisualsStaleInTransaction } from '@/services/content-lineage'

export async function clearProjectExtractedEntitiesInTransaction(tx: Prisma.TransactionClient, projectId: bigint) {
    const [oldCharacters, oldScenes] = await Promise.all([
        tx.character.findMany({ where: { projectId }, select: { id: true, deletedAt: true } }),
        tx.scene.findMany({ where: { projectId }, select: { id: true, deletedAt: true } })
    ])
    const oldCharacterIds = oldCharacters.map(character => character.id)
    const oldSceneIds = oldScenes.map(scene => scene.id)

    await tx.refImageJob.deleteMany({ where: { projectId, targetType: { in: ['character', 'scene'] } } })
    if (oldCharacterIds.length > 0) {
        await tx.characterReferenceAsset.deleteMany({ where: { characterId: { in: oldCharacterIds } } })
        await tx.seedancePortraitAsset.deleteMany({ where: { characterId: { in: oldCharacterIds } } })
        await tx.seedancePortraitSession.deleteMany({ where: { characterId: { in: oldCharacterIds } } })
        await tx.characterStateEvent.deleteMany({ where: { characterId: { in: oldCharacterIds } } })
        await tx.storyboardCharacter.deleteMany({ where: { characterId: { in: oldCharacterIds } } })
        await tx.character.deleteMany({ where: { id: { in: oldCharacterIds } } })
    }
    if (oldSceneIds.length > 0) {
        await tx.storyboard.updateMany({
            where: { sceneId: { in: oldSceneIds } },
            data: { sceneId: null, operationVersion: { increment: 1 } }
        })
        await tx.scene.deleteMany({ where: { id: { in: oldSceneIds } } })
    }
    if (oldCharacterIds.length || oldSceneIds.length) {
        await markProjectVisualsStaleInTransaction(tx, projectId, '旧角色和场景已清空，请基于全新入库的角色、场景及参考图重新生成分镜插图和视频')
    }

    return {
        removedCharacters: oldCharacters.filter(character => character.deletedAt === null).length,
        removedScenes: oldScenes.filter(scene => scene.deletedAt === null).length
    }
}
