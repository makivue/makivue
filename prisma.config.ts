// Prisma is the source of truth for DDL — use `prisma migrate` to evolve
// tables. Do not manually alter tables in MySQL; instead update
// prisma/schema.prisma and add a migration under prisma/migrations/.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { databaseUrlFromEnvironment } from './scripts/database-environment.mjs'

export default defineConfig({
    schema: 'prisma/schema.prisma',
    datasource: {
        url: databaseUrlFromEnvironment()
    }
})
