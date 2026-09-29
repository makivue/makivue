import type { NovelCharacterInput, NovelSetup } from '@/lib/novel'
import { normalizeCanonicalName } from '@/lib/project-metadata'
import { genId } from '@/lib/id'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

const SETUP_CHARACTER_SYNC_VERSION = 1

const CHARACTER_FIELD_LIMITS = {
    name: 100,
    canonicalName: 100,
    role: 50,
    age: 20,
    gender: 20
} as const

function inlineText(value: string | undefined) {
    return value?.replace(/\s+/gu, ' ').trim() ?? ''
}

function truncateCharacters(value: string, maxLength: number) {
    return Array.from(value).slice(0, maxLength).join('')
}

function boundedText(value: string | undefined, maxLength: number) {
    return truncateCharacters(inlineText(value), maxLength)
}

function normalizeRole(value: string | undefined, fallback: string) {
    const raw = inlineText(value)
    if (!raw) return { role: fallback, detail: null }

    const body = raw.replace(/^(?:角色(?:定位|类型)?|人物(?:定位|类型)?|身份|role)\s*[：:]\s*/iu, '').trim() || raw
    const firstClause = body.split(/[，,。；;：:\n|｜]/u).find(Boolean)?.trim() || body
    const concise = Array.from(firstClause).length > CHARACTER_FIELD_LIMITS.role
        ? firstClause.split(/[（(—]/u)[0]?.trim() || firstClause
        : firstClause
    const role = truncateCharacters(concise, CHARACTER_FIELD_LIMITS.role) || fallback
    return { role, detail: role === body ? null : body }
}

function appendRoleDetail(personality: string | null, roleDetail: string | null) {
    if (!roleDetail || personality?.includes(roleDetail)) return personality
    const detail = `角色定位补充：${roleDetail}`
    return personality ? `${personality}\n${detail}` : detail
}

export function buildSetupCharacterCandidates(setup: NovelSetup) {
    const rows: Array<{ character: NovelCharacterInput; group: 'main' | 'supporting' }> = [
        ...(setup.mainCharacters ?? []).map(character => ({ character, group: 'main' as const })),
        ...(setup.supportingCharacters ?? []).map(character => ({ character, group: 'supporting' as const }))
    ]
    const byCanonicalName = new Map<string, ReturnType<typeof toCandidate>>()
    for (const row of rows) {
        const candidate = toCandidate(row.character, row.group)
        if (candidate.canonicalName && !byCanonicalName.has(candidate.canonicalName)) byCanonicalName.set(candidate.canonicalName, candidate)
    }
    return [...byCanonicalName.values()]
}

function toCandidate(character: NovelCharacterInput, group: 'main' | 'supporting') {
    const name = boundedText(character.name, CHARACTER_FIELD_LIMITS.name)
    const canonicalName = truncateCharacters(normalizeCanonicalName(name), CHARACTER_FIELD_LIMITS.canonicalName)
    const rawAge = inlineText(character.age)
    const rawGender = inlineText(character.gender)
    const { role, detail: roleDetail } = normalizeRole(character.role, group === 'main' ? '主要角色' : '配角')
    const personality = appendRoleDetail(inlineText(character.persona) || null, roleDetail)
    const appearancePrompt = [rawAge ? `年龄：${rawAge}` : '', rawGender ? `性别：${rawGender}` : '', personality ?? ''].filter(Boolean).join('；')
    return {
        name,
        canonicalName,
        role,
        roleDetail,
        age: boundedText(character.age, CHARACTER_FIELD_LIMITS.age) || null,
        gender: boundedText(character.gender, CHARACTER_FIELD_LIMITS.gender) || null,
        personality,
        appearancePrompt: appearancePrompt || null,
        aliases: [name] as Prisma.InputJsonValue,
        sourceType: 'novel_setup',
        sourceVersion: SETUP_CHARACTER_SYNC_VERSION,
        confirmationStatus: 'candidate'
    }
}

export async function syncSetupCharacters(projectId: bigint, setup: NovelSetup) {
    return prisma.$transaction(tx => syncSetupCharactersInTransaction(tx, projectId, setup))
}

export async function syncSetupCharactersInTransaction(tx: Prisma.TransactionClient, projectId: bigint, setup: NovelSetup) {
    const candidates = buildSetupCharacterCandidates(setup)
    if (candidates.length === 0) return { created: 0, updated: 0 }

    const existing = await tx.character.findMany({ where: { projectId, deletedAt: null } })
    const byCanonicalName = new Map(existing.map(character => [character.canonicalName ?? normalizeCanonicalName(character.name), character]))
    let created = 0
    let updated = 0
    for (const candidate of candidates) {
        const current = byCanonicalName.get(candidate.canonicalName)
        if (!current) {
            await tx.character.create({
                data: {
                    id: genId(),
                    projectId,
                    name: candidate.name,
                    canonicalName: candidate.canonicalName,
                    role: candidate.role,
                    age: candidate.age,
                    gender: candidate.gender,
                    personality: candidate.personality,
                    appearancePrompt: candidate.appearancePrompt,
                    aliases: candidate.aliases,
                    sourceType: candidate.sourceType,
                    sourceVersion: candidate.sourceVersion,
                    confirmationStatus: candidate.confirmationStatus
                }
            })
            created += 1
            continue
        }
        await tx.character.update({
            where: { id: current.id },
            data: {
                canonicalName: candidate.canonicalName,
                aliases: [...new Set([...(Array.isArray(current.aliases) ? (current.aliases as string[]) : []), candidate.name])] as Prisma.InputJsonValue,
                role: current.role || candidate.role,
                age: current.age || candidate.age,
                gender: current.gender || candidate.gender,
                personality: appendRoleDetail(current.personality || candidate.personality, candidate.roleDetail),
                appearancePrompt: current.appearancePrompt || candidate.appearancePrompt,
                sourceType: current.sourceType || candidate.sourceType,
                sourceVersion: { increment: 1 }
            }
        })
        updated += 1
    }
    return { created, updated }
}
