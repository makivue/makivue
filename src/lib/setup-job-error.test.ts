import { describe, expect, it } from 'vitest'
import { presentSetupJobError } from './setup-job-error'

describe('setup job error presentation', () => {
    it('hides a Prisma varchar overflow behind a useful message', () => {
        expect(presentSetupJobError("Invalid `prisma.character.create()` invocation: The provided value for the column is too long for the column's type. Column: role"))
            .toBe('生成的角色信息过长，故事架构保存失败，请重新生成')
    })

    it('hides other Prisma implementation details', () => {
        expect(presentSetupJobError('Invalid `prisma.project.update()` invocation: database unavailable'))
            .toBe('故事架构保存失败，请稍后重试')
    })

    it('keeps an actionable domain error', () => {
        expect(presentSetupJobError('故事架构连续性校验失败：第 2 集缺少开场状态'))
            .toBe('故事架构连续性校验失败：第 2 集缺少开场状态')
    })
})
