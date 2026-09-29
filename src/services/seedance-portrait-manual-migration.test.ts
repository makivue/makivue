import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Seedance portrait manual database rollout', () => {
    const root = process.cwd()
    const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260816_add_seedance_portrait_flow/migration.sql'), 'utf8')
    const manualSql = fs.readFileSync(path.join(root, 'docs/sql/20260816_seedance_portrait_flow_manual.sql'), 'utf8')
    const entrypoint = fs.readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8')

    it('does not require unavailable REFERENCES privileges on Aliyun RDS', () => {
        expect(migration).not.toMatch(/\bFOREIGN KEY\b/)
        expect(migration).not.toMatch(/\bREFERENCES\s+`/)
    })

    it('provides idempotent SQL that also resolves the existing P3009 row', () => {
        const checksum = createHash('sha256').update(migration).digest('hex')
        expect(manualSql).toContain('CREATE TABLE IF NOT EXISTS `seedance_portrait_sessions`')
        expect(manualSql).toContain('CREATE TABLE IF NOT EXISTS `seedance_portrait_assets`')
        expect(manualSql).toContain('UPDATE `_prisma_migrations`')
        expect(manualSql).toContain(checksum)
        expect(manualSql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i)
    })

    it('does not add a CD-side repair path for this migration', () => {
        expect(entrypoint).not.toContain('repair-seedance-portrait-flow-migration')
    })
})
