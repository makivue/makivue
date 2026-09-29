import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/utils'
import { currentSession } from '@/lib/current-user'
import { ROOT_ADMIN_EMAIL } from '@/lib/session-token'

const ADMIN_PERMISSION_KEYS = ['manage_users', 'manage_settings', 'generate_style_previews', 'view_system'] as const
export type AdminPermission = (typeof ADMIN_PERMISSION_KEYS)[number]

export type AdminAccess = {
    email: string
    role: string
    permissions: AdminPermission[]
    superAdmin: boolean
}

function normalizePermissions(value: unknown): AdminPermission[] {
    if (!Array.isArray(value)) return []
    const allowed = new Set<string>(ADMIN_PERMISSION_KEYS)
    return [...new Set(value.filter((item): item is AdminPermission => typeof item === 'string' && allowed.has(item)))]
}

export async function getAdminAccess(req: NextRequest | Request): Promise<AdminAccess | null> {
    const session = currentSession(req)
    if (!session) return null
    if (session.email === ROOT_ADMIN_EMAIL) {
        return { email: session.email, role: 'super_admin', permissions: [...ADMIN_PERMISSION_KEYS], superAdmin: true }
    }
    const grant = await prisma.adminGrant.findUnique({ where: { email: session.email } })
    if (!grant?.enabled) return null
    return {
        email: grant.email,
        role: grant.role,
        permissions: normalizePermissions(grant.permissions),
        superAdmin: false
    }
}

export async function requireAdminPermission(req: NextRequest | Request, permission: AdminPermission) {
    const session = currentSession(req)
    if (!session) return { access: null, response: apiError('登录状态已失效，请重新登录', 401) }
    const access = await getAdminAccess(req)
    if (!access || (!access.superAdmin && !access.permissions.includes(permission))) {
        return { access: null, response: apiError('没有执行此操作的权限', 403) }
    }
    return { access, response: null }
}
