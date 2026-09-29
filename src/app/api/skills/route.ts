import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getProjectSkill, getProjectSkillManifest, getProjectSkillsForStage, listProjectSkills } from '@/services/project-skills'
import type { WorkflowStageKey } from '@/services/workflow'
import { currentUserId } from '@/lib/current-user'

export async function GET(req: NextRequest) {
    if (currentUserId(req) === null) return apiError('登录状态已失效，请重新登录', 401)
    try {
        const { searchParams } = new URL(req.url)
        const id = searchParams.get('id')
        const stage = searchParams.get('stage') as WorkflowStageKey | null
        const includeContent = searchParams.get('content') === '1'

        if (id) {
            const skill = await getProjectSkill(id)
            if (!skill) return apiError('Skill not found', 404)
            return apiResponse(skill)
        }

        if (stage) {
            const skills = includeContent ? await getProjectSkillsForStage(stage) : await listProjectSkills(stage)
            return apiResponse({ skills })
        }

        const manifest = await getProjectSkillManifest()
        return apiResponse(manifest)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return apiError(msg, 500)
    }
}
