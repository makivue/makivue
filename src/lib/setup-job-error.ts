const SETUP_FIELD_TOO_LONG_ERROR = '生成的角色信息过长，故事架构保存失败，请重新生成'
const SETUP_SAVE_ERROR = '故事架构保存失败，请稍后重试'

export function presentSetupJobError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '')
    if (/\bP2000\b|provided value.+column.+too long|column.+too long.+column(?:'s)? type/isu.test(message)) {
        return SETUP_FIELD_TOO_LONG_ERROR
    }
    if (/Invalid\s+[`']?prisma\.|PrismaClient(?:KnownRequest)?Error/iu.test(message)) return SETUP_SAVE_ERROR
    return message || '故事架构生成失败，请重试'
}
