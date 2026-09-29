import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { searchParams } = new URL(req.url)
    const rawProjectId = searchParams.get('projectId')
    if (!rawProjectId) return apiError('projectId required')
    const projectId = parseApiId(rawProjectId)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const characters = await prisma.character.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'asc' }
    })
    return apiResponse(characters)
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const body = await req.json()
    const { projectId: rawProjectId, name, role, age, gender, appearancePrompt, personality } = body
    if (!rawProjectId || !name) return apiError('projectId and name required')
    const projectId = parseApiId(rawProjectId)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const character = await prisma.character.create({
        data: { id: genId(), projectId, name, role, age, gender, appearancePrompt, personality }
    })
    return apiResponse(character, 201)
}
