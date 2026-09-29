import { localMediaResponse } from '@/services/local-media'

export const runtime = 'nodejs'
export async function GET(request: Request) {
    return localMediaResponse(new URL(request.url).pathname, { headers: request.headers })
}
export async function HEAD(request: Request) {
    return localMediaResponse(new URL(request.url).pathname, { method: 'HEAD', headers: request.headers })
}
