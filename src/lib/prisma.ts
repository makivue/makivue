// Compatibility name for existing services. Persistence is local JSON files.
// No PrismaClient is instantiated and no database connection is opened.
import { createLocalFileClient } from './local-store'

export const prisma = createLocalFileClient()
