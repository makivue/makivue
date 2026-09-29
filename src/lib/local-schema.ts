import fs from 'node:fs'
import path from 'node:path'

export type LocalField = {
    name: string
    type: string
    optional: boolean
    list: boolean
    relation: boolean
    from: string[]
    to: string[]
    relationName?: string
    defaultValue?: string
    updatedAt: boolean
}
export type LocalModel = { name: string; fields: Record<string, LocalField>; unique: string[][] }
let cached: Record<string, LocalModel> | undefined

// The schema describes record shapes only. This parser does not use a database,
// query engine, migration, connection string, or SQL.
export function localModels(): Record<string, LocalModel> {
    if (cached) return cached
    const source = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const models: Record<string, LocalModel> = {}
    const blocks = [...source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    const names = new Set(blocks.map(match => match[1]))
    for (const [, name, body] of blocks) {
        const fields: Record<string, LocalField> = {}
        const unique: string[][] = []
        for (const raw of body.split('\n')) {
            const line = raw.trim()
            const compound = /^@@(?:unique|id)\(\[([^\]]+)\]/.exec(line)
            if (compound) unique.push(compound[1].split(',').map(field => field.trim()))
            const match = /^(\w+)\s+(\w+)(\[\]|\?)?(?:\s+(.*))?$/.exec(line)
            if (!match) continue
            const [, field, type, modifier, attributes = ''] = match
            const list = (key: string) =>
                new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`)
                    .exec(attributes)?.[1]
                    .split(',')
                    .map(value => value.trim()) || []
            fields[field] = {
                name: field,
                type,
                optional: modifier === '?',
                list: modifier === '[]',
                relation: names.has(type),
                from: list('fields'),
                to: list('references'),
                relationName: /@relation\("([^"]+)"/.exec(attributes)?.[1],
                defaultValue: /@default\((.+?)\)(?=\s+@|\s*$)/.exec(attributes)?.[1],
                updatedAt: attributes.includes('@updatedAt')
            }
            if (/@(?:id|unique)\b/.test(attributes)) unique.push([field])
        }
        models[name] = { name, fields, unique }
    }
    if (!models.Project || !models.Episode || !models.Storyboard) throw new Error('Local workspace schema is incomplete')
    cached = models
    return models
}
