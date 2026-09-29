export const GENERATION_CONCURRENCY_LIMITS = {
    image: { project: 15, user: 15, queued: 15 },
    video: { project: 10, user: 10, queued: 10 }
} as const

export const MAX_ACTIVE_PROJECTS_PER_USER = 6
