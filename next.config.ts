import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const nextConfig = (): NextConfig => ({
    distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
    trailingSlash: false,
    experimental: { proxyClientMaxBodySize: '301mb' },
    turbopack: { root: projectRoot },
    images: { qualities: [65, 75, 78, 85] },
    allowedDevOrigins: ['127.0.0.1', 'localhost'],
    serverExternalPackages: ['fluent-ffmpeg', 'pdf-parse', 'google-auth-library', 'proper-lockfile'],
    outputFileTracingIncludes: { '/*': ['./prisma/schema.prisma'] },
    outputFileTracingExcludes: { '/*': ['./data/**/*', './data.lock/**/*', './.env*', './.secrets/**/*', './output/**/*', './tmp/**/*'] },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' }
                ]
            }
        ]
    }
})
export default nextConfig
