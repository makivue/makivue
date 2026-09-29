import { NextRequest } from 'next/server'
import { handleUploadStyleImage, handleDeleteStyleImage } from './_handler'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Params) {
    return handleUploadStyleImage(req, ctx)
}

export async function DELETE(req: NextRequest, ctx: Params) {
    return handleDeleteStyleImage(req, ctx)
}
