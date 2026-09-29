import { NextRequest } from 'next/server'
import { handleUploadStyleImage, handleDeleteStyleImage } from './_handler'
import type { LocalMediaEnvironment } from '@/services/local-media'

type Params = { params: Promise<{ id: string }> }

// 兼容旧调用：不带 /test 或 /prod 时，按运行时 env 判定；建议前端改用 /test 或 /prod 显式指定。
function resolveDefaultEnv(): LocalMediaEnvironment {
    if (process.env.OSS_ENV === 'prod' || process.env.OSS_ENV === 'test') return process.env.OSS_ENV
    return process.env.NODE_ENV === 'production' ? 'prod' : 'test'
}

export async function POST(req: NextRequest, ctx: Params) {
    return handleUploadStyleImage(req, ctx, resolveDefaultEnv())
}

export async function DELETE(req: NextRequest, ctx: Params) {
    return handleDeleteStyleImage(req, ctx, resolveDefaultEnv())
}
