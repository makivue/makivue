import { NextRequest } from 'next/server'
import { apiError, apiResponse } from '@/lib/utils'
import { currentSession } from '@/lib/current-user'
import { getAdminAccess } from '@/lib/admin-permissions'

export async function GET(req: NextRequest) {
    const session = currentSession(req)
    if (!session) return apiError('登录状态已失效，请重新登录', 401)
    const access = await getAdminAccess(req)
    return apiResponse({
        email: session.email,
        isAdmin: Boolean(access),
        role: access?.role ?? null,
        permissions: access?.permissions ?? [],
        superAdmin: access?.superAdmin ?? false
    })
}
