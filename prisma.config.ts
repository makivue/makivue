import { defineConfig } from 'prisma/config'

// Generate shared data types only. The runtime reads and writes local JSON.
export default defineConfig({ schema: 'prisma/schema.prisma' })
