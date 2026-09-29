import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { getVisualStyle, getVisualStyleProfile, parseNovelSetup, stringifyNovelSetup, type NovelEpisodeStatePlan } from '@/lib/novel'
import type { DetectedScriptEpisode, DetectedScriptResult } from '@/services/script-import'
import { buildStoryboardContinuityState } from '@/lib/storyboard-state'
import { normalizeStoryboardActionPlan } from '@/lib/storyboard-action-plan'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'
import { normalizeGenre } from '@/lib/project-metadata'
import { buildEpisodeFactSnapshot } from '@/lib/content-contracts'
import { Prisma } from '@/generated/prisma/client'
import { DEFAULT_SUBTITLE_LANGUAGES, isProjectEpisodeFormat, publicationFieldsFromSetup } from '@/lib/project-publication'
import { normalizeContentLanguage } from '@/lib/content-language'
import type { Locale } from '@/i18n/config'

export type ImportVideoAspectRatio = '9:16' | '16:9' | '1:1'

export async function persistDetectedImport({
    userId,
    detected,
    visualStyle,
    videoAspectRatio,
    contentLanguage,
    episodeFormat,
    projectId: requestedProjectId
}: {
    userId: bigint
    detected: DetectedScriptResult
    visualStyle: string
    videoAspectRatio: ImportVideoAspectRatio
    contentLanguage?: Locale
    episodeFormat?: 'micro' | 'short' | 'long'
    /** Stable ID persisted in the import job before the transaction starts. */
    projectId?: bigint
}) {
    const projectTitle = detected.projectTitle?.trim() || `导入项目 ${new Date().toISOString().slice(0, 10)}`
    const totalEpisodes = Math.max(1, detected.totalEpisodes ?? detected.episodes?.length ?? detected.outline?.length ?? 1)
    const hasChapterContent = (detected.episodes ?? []).some(episode => episode.chapterContent?.trim())
    const stageMap: Record<string, string> = { outline: 'outlined', novel: hasChapterContent ? 'drafting' : 'needs_split', script: 'scripted', storyboard: 'scripted' }
    const novelStage = stageMap[detected.stage] ?? 'outlined'
    const joinedNovel = (detected.episodes ?? [])
        .map(episode => episode.chapterContent)
        .filter(Boolean)
        .join('\n\n---\n\n')
    const fullNovel = detected.novel ?? (joinedNovel || undefined)
    const setup = parseNovelSetup(null)
    const normalizedGenre = normalizeGenre(detected.genre)
    const resolvedVisualStyle = getVisualStyle(visualStyle)
    const publicationSetup = {
        ...setup,
        primaryGenre: normalizedGenre.label,
        videoAspectRatio,
        contentLanguage: normalizeContentLanguage(contentLanguage),
        episodeFormat: isProjectEpisodeFormat(episodeFormat) ? episodeFormat : 'micro',
        visualStyle: resolvedVisualStyle.key,
        visualStyleProfile: getVisualStyleProfile(resolvedVisualStyle.key)
    }
    const projectId = requestedProjectId ?? genId()

    // The project transaction may have committed immediately before a process
    // restart. A stable project ID turns the retry into a read instead of
    // creating a duplicate project.
    if (requestedProjectId) {
        const existing = await prisma.project.findUnique({
            where: { id: projectId },
            select: { userId: true, totalEpisodes: true, novelStage: true }
        })
        if (existing) {
            if (existing.userId !== userId) throw new Error('Project not found')
            const totalStoryboards = await prisma.storyboard.count({
                where: { deletedAt: null, episode: { projectId } }
            })
            return {
                projectId: projectId.toString(),
                stage: detected.stage,
                novelStage: existing.novelStage,
                totalEpisodes: existing.totalEpisodes,
                totalStoryboards,
                detectedTitle: detected.projectTitle,
                detectedGenre: detected.genre,
                visualStyle: resolvedVisualStyle.key
            }
        }
    }

    const outlineByNum = new Map<number, { title?: string; synopsis?: string; intensity?: number }>()
    for (const chapter of detected.outline ?? []) outlineByNum.set(chapter.episodeNumber, chapter)
    const episodeDataByNum = new Map<number, DetectedScriptEpisode>()
    for (const episode of detected.episodes ?? []) episodeDataByNum.set(episode.episodeNumber, episode)

    const episodeStatePlan: NovelEpisodeStatePlan[] = Array.from({ length: totalEpisodes }, (_, index) => {
        const episodeNumber = index + 1
        const outline = outlineByNum.get(episodeNumber)
        const episode = episodeDataByNum.get(episodeNumber)
        const synopsis = episode?.synopsis ?? outline?.synopsis ?? ''
        const openingAnchor = synopsis.slice(0, 180).trim() || `第${episodeNumber}集开场状态待人工补充`
        const endingAnchor = synopsis.slice(-180).trim() || `第${episodeNumber}集结尾状态待人工补充`
        return {
            episodeNumber,
            openingState: openingAnchor,
            endingState: endingAnchor,
            characterStateChanges: `按第${episodeNumber}集导入梗概维护角色状态：${synopsis.slice(0, 220) || '待人工补充'}`,
            continuityBridge: episodeNumber === 1 ? '建立故事开场' : `承接第${episodeNumber - 1}集结尾并进入本集开场`
        }
    })
    const stateByEpisode = new Map(episodeStatePlan.map(state => [state.episodeNumber, state]))

    const episodes = Array.from({ length: totalEpisodes }, (_, index) => {
        const episodeNumber = index + 1
        const outline = outlineByNum.get(episodeNumber)
        const episode = episodeDataByNum.get(episodeNumber)
        return {
            id: genId(),
            projectId,
            episodeNumber,
            title: episode?.title ?? outline?.title ?? `第${episodeNumber}集`,
            synopsis: episode?.synopsis ?? outline?.synopsis ?? null,
            chapterContent: episode?.chapterContent ?? null,
            script: episode?.script ?? null,
            intensity: outline?.intensity ?? null,
            status:
                detected.stage === 'outline'
                    ? 'outlined'
                    : detected.stage === 'novel'
                      ? episode?.chapterContent?.trim()
                          ? 'drafted'
                          : 'needs_split'
                      : detected.stage === 'storyboard'
                        ? 'storyboarded'
                        : 'scripted',
            contentFacts: buildEpisodeFactSnapshot({
                episodeNumber,
                synopsis: episode?.synopsis ?? outline?.synopsis,
                statePlan: stateByEpisode.get(episodeNumber)
            }) as unknown as Prisma.InputJsonValue,
            stateSnapshot: (stateByEpisode.get(episodeNumber) as unknown as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull
        }
    })
    const storyboards =
        detected.stage === 'storyboard'
            ? episodes.flatMap(episode =>
                  (episodeDataByNum.get(episode.episodeNumber)?.storyboards ?? []).map(storyboard => {
                      const duration = storyboard.duration ?? 5
                      const actionPlan = normalizeStoryboardActionPlan(undefined, storyboard.actionDesc)
                      const audioPlan = buildStoryboardAudioPlan({ duration, dialogue: storyboard.dialogue, narration: storyboard.narration })
                      return {
                          id: genId(),
                          episodeId: episode.id,
                          order: storyboard.order,
                          shotType: storyboard.shotType ?? null,
                          duration,
                          dialogue: storyboard.dialogue ?? null,
                          narration: storyboard.narration ?? null,
                          actionDesc: storyboard.actionDesc ?? null,
                          ...(actionPlan ? { actionPlan: actionPlan as unknown as Prisma.InputJsonValue } : {}),
                          ...(audioPlan ? { audioPlan: audioPlan as unknown as Prisma.InputJsonValue } : {}),
                          imagePrompt: storyboard.imagePrompt ?? null,
                          continuityState: buildStoryboardContinuityState({
                              continuityMode: 'independent',
                              actionDesc: [
                                  storyboard.actionDesc,
                                  `Opening state: ${stateByEpisode.get(episode.episodeNumber)?.openingState ?? '待补充'}`,
                                  `Ending state: ${stateByEpisode.get(episode.episodeNumber)?.endingState ?? '待补充'}`
                              ]
                                  .filter(Boolean)
                                  .join('; '),
                              shotType: storyboard.shotType ?? null,
                              characters: []
                          }),
                          generationStage: 'imported',
                          polishStatus: 'not_required',
                          promptVersion: 'import/storyboard-v1'
                      }
                  })
              )
            : []

    await prisma.$transaction([
        prisma.project.create({
            data: {
                id: projectId,
                userId,
                title: projectTitle,
                description: detected.projectDescription ?? null,
                genre: normalizedGenre.label,
                genreCode: normalizedGenre.code,
                genreLabel: normalizedGenre.label,
                totalEpisodes,
                seoTitle: projectTitle.slice(0, 120),
                seoDescription: detected.projectDescription?.slice(0, 500) ?? null,
                seoKeywords: [normalizedGenre.label, projectTitle].filter(Boolean),
                coverAlt: projectTitle.slice(0, 255),
                subtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES,
                ...publicationFieldsFromSetup(publicationSetup),
                novel: fullNovel || null,
                novelStage,
                status: novelStage === 'outlined' ? 'draft' : 'in_production',
                contentFacts: episodeStatePlan.map(state =>
                    buildEpisodeFactSnapshot({ episodeNumber: state.episodeNumber, synopsis: outlineByNum.get(state.episodeNumber)?.synopsis, statePlan: state })
                ) as unknown as Prisma.InputJsonValue,
                novelSetup: stringifyNovelSetup({
                    ...publicationSetup,
                    episodeStatePlan,
                    factLedger: episodeStatePlan.map(state =>
                        buildEpisodeFactSnapshot({ episodeNumber: state.episodeNumber, synopsis: outlineByNum.get(state.episodeNumber)?.synopsis, statePlan: state })
                    ),
                    fieldSources: {
                        primaryGenre: 'import',
                        videoAspectRatio: 'user',
                        visualStyle: 'user',
                        visualStyleProfile: 'curated-preset',
                        episodeStatePlan: 'derived_from_import'
                    }
                })
            }
        }),
        prisma.episode.createMany({ data: episodes }),
        ...(storyboards.length > 0 ? [prisma.storyboard.createMany({ data: storyboards })] : [])
    ])

    return {
        projectId: projectId.toString(),
        stage: detected.stage,
        novelStage,
        totalEpisodes,
        totalStoryboards: storyboards.length,
        detectedTitle: detected.projectTitle,
        detectedGenre: detected.genre,
        visualStyle: resolvedVisualStyle.key
    }
}
