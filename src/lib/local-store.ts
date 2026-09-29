/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic record boundary; callers retain generated model types. */
import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import lockfile from 'proper-lockfile'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { localDataDirectory } from './local-paths'
import { localModels, type LocalField, type LocalModel } from './local-schema'

type Row = Record<string, any>
type State = { version: 1; collections: Record<string, Row[]> }
type Context = { directory: string; state: State; dirty: boolean; closed: boolean }
const globals = globalThis as typeof globalThis & { localWorkspaceContext?: AsyncLocalStorage<Context> }
const context = (globals.localWorkspaceContext ??= new AsyncLocalStorage<Context>())
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const plain = (value: any): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !Prisma.Decimal.isDecimal(value)

function error(code: string, message: string): never {
    throw new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'local-json' })
}
function convert(field: LocalField, value: any): any {
    if (value === undefined || value === null || value === Prisma.JsonNull || value === Prisma.DbNull) return null
    if (field.type === 'BigInt') return BigInt(value)
    if (field.type === 'Decimal') return new Prisma.Decimal(value)
    if (field.type === 'DateTime') {
        const date = new Date(value)
        if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${field.name}`)
        return date
    }
    return value
}
function encode(state: State) {
    return JSON.stringify(state, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2) + '\n'
}
function decode(text: string): State {
    const state = JSON.parse(text) as State
    if (state.version !== 1 || !plain(state.collections)) throw new Error('Unsupported local workspace format')
    for (const model of Object.values(localModels())) {
        if (!own(state.collections, model.name)) state.collections[model.name] = []
        if (!Array.isArray(state.collections[model.name])) throw new Error(`Invalid local collection: ${model.name}`)
        state.collections[model.name] = state.collections[model.name].map(row => {
            if (!plain(row)) throw new Error(`Invalid local record: ${model.name}`)
            // Preserve unknown fields so an older app cannot erase newer user data.
            return {
                ...row,
                ...Object.fromEntries(
                    Object.values(model.fields)
                        .filter(field => !field.relation)
                        .map(field => [field.name, convert(field, row[field.name])])
                )
            }
        })
    }
    return state
}
async function read(directory: string): Promise<State> {
    try {
        return decode(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8'))
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, collections: {} }
        throw new Error('本地项目文件无法读取；请保留 workspace.json 并检查文件或恢复备份。', { cause })
    }
}
async function write(directory: string, state: State) {
    const temporary = path.join(directory, `.workspace-${randomUUID()}.tmp`)
    try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try {
            await handle.writeFile(encode(state))
            await handle.sync()
        } finally {
            await handle.close()
        }
        await fs.rename(temporary, path.join(directory, 'workspace.json'))
        if (process.platform !== 'win32') {
            const folder = await fs.open(directory, 'r')
            try {
                await folder.sync()
            } finally {
                await folder.close()
            }
        }
    } finally {
        await fs.rm(temporary, { force: true })
    }
}
function rows(state: State, model: LocalModel): Row[] {
    return (state.collections[model.name] ??= [])
}
function compare(left: any, right: any): number {
    if (left == null) return right == null ? 0 : -1
    if (right == null) return 1
    if (Prisma.Decimal.isDecimal(left) || Prisma.Decimal.isDecimal(right)) return new Prisma.Decimal(left).comparedTo(right)
    if (left instanceof Date || right instanceof Date) return new Date(left).getTime() - new Date(right).getTime()
    if (typeof left === 'bigint' || typeof right === 'bigint') return BigInt(left) < BigInt(right) ? -1 : BigInt(left) === BigInt(right) ? 0 : 1
    if (typeof left === 'object' || typeof right === 'object') return JSON.stringify(left).localeCompare(JSON.stringify(right))
    return left < right ? -1 : left > right ? 1 : 0
}
function scalar(value: any, condition: any): boolean {
    if (condition === undefined) return true
    if (!plain(condition)) return compare(value, condition) === 0
    if (condition.mode === 'insensitive' && typeof value === 'string') value = value.toLocaleLowerCase()
    const normal = (other: any) => (condition.mode === 'insensitive' && typeof other === 'string' ? other.toLocaleLowerCase() : other)
    if (Array.isArray(condition.path)) value = condition.path.reduce((current: any, key: string) => current?.[key], value)
    return Object.entries(condition).every(([operator, operand]: [string, any]) => {
        switch (operator) {
            case 'mode':
            case 'path':
                return true
            case 'equals':
                return operand === Prisma.AnyNull ? value == null : compare(value, normal(operand)) === 0
            case 'not':
                return !scalar(value, operand)
            case 'in':
                return operand.some((item: any) => compare(value, normal(item)) === 0)
            case 'notIn':
                return !operand.some((item: any) => compare(value, normal(item)) === 0)
            case 'lt':
                return value != null && compare(value, operand) < 0
            case 'lte':
                return value != null && compare(value, operand) <= 0
            case 'gt':
                return value != null && compare(value, operand) > 0
            case 'gte':
                return value != null && compare(value, operand) >= 0
            case 'contains':
                return typeof value === 'string' && value.includes(normal(operand))
            case 'startsWith':
                return typeof value === 'string' && value.startsWith(normal(operand))
            case 'endsWith':
                return typeof value === 'string' && value.endsWith(normal(operand))
            case 'array_contains':
                return Array.isArray(value) && (Array.isArray(operand) ? operand : [operand]).every(item => value.some(entry => compare(entry, item) === 0))
            default:
                throw new Error(`Unsupported local query operator: ${operator}`)
        }
    })
}
function related(state: State, model: LocalModel, row: Row, field: LocalField): Row[] {
    const target = localModels()[field.type]
    if (field.from.length) return rows(state, target).filter(candidate => field.from.every((key, i) => row[key] != null && compare(row[key], candidate[field.to[i]]) === 0))
    const inverse = Object.values(target.fields).find(candidate => candidate.relation && candidate.type === model.name && candidate.from.length && candidate.relationName === field.relationName)
    if (!inverse) throw new Error(`Missing local relation: ${model.name}.${field.name}`)
    return rows(state, target).filter(candidate => inverse.from.every((key, i) => candidate[key] != null && compare(candidate[key], row[inverse.to[i]]) === 0))
}
function matches(state: State, model: LocalModel, row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, condition]: [string, any]) => {
        if (condition === undefined) return true
        if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every(item => matches(state, model, row, item))
        if (key === 'OR') return condition.some((item: Row) => matches(state, model, row, item))
        if (key === 'NOT') return (Array.isArray(condition) ? condition : [condition]).every(item => !matches(state, model, row, item))
        const field = model.fields[key]
        if (!field) {
            if (model.unique.some(keys => keys.join('_') === key)) return matches(state, model, row, condition)
            throw new Error(`Unknown local field: ${model.name}.${key}`)
        }
        if (!field.relation) return scalar(row[key], condition)
        const relation = related(state, model, row, field)
        const target = localModels()[field.type]
        if (condition === null) return relation.length === 0
        if ('some' in condition) return relation.some(item => matches(state, target, item, condition.some))
        if ('none' in condition) return !relation.some(item => matches(state, target, item, condition.none))
        if ('every' in condition) return relation.every(item => matches(state, target, item, condition.every))
        if ('is' in condition) return condition.is === null ? relation.length === 0 : relation.some(item => matches(state, target, item, condition.is))
        if ('isNot' in condition) return condition.isNot === null ? relation.length > 0 : !relation.some(item => matches(state, target, item, condition.isNot))
        return relation.some(item => matches(state, target, item, condition))
    })
}
function queryRows(state: State, model: LocalModel, args: Row = {}, candidates = rows(state, model)): Row[] {
    let result = candidates.filter(row => matches(state, model, row, args.where))
    const orders = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []
    result.sort((a, b) => {
        for (const order of orders)
            for (const [key, direction] of Object.entries(order) as [string, any][]) {
                const delta = compare(a[key], b[key])
                if (delta) return delta * ((plain(direction) ? direction.sort : direction) === 'desc' ? -1 : 1)
            }
        return 0
    })
    if (args.distinct) {
        const keys = Array.isArray(args.distinct) ? args.distinct : [args.distinct]
        const seen = new Set<string>()
        result = result.filter(row => {
            const key = JSON.stringify(keys.map((field: string) => String(row[field])))
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }
    if (args.cursor) {
        const index = result.findIndex(row => matches(state, model, row, args.cursor))
        result = index < 0 ? [] : args.take < 0 ? result.slice(0, index + 1).reverse() : result.slice(index)
    } else if (args.take < 0) result.reverse()
    const start = args.skip || 0
    result = result.slice(start, args.take === undefined ? undefined : start + Math.abs(args.take))
    if (args.take < 0) result.reverse()
    return result
}
function clone(value: any): any {
    if (value instanceof Date) return new Date(value)
    if (Prisma.Decimal.isDecimal(value)) return new Prisma.Decimal(value)
    if (Array.isArray(value)) return value.map(clone)
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
    return value
}
function select(state: State, model: LocalModel, row: Row, args: Row = {}): Row {
    const result: Row = args.select
        ? {}
        : Object.fromEntries(
              Object.values(model.fields)
                  .filter(field => !field.relation)
                  .map(field => [field.name, row[field.name]])
          )
    for (const [key, value] of Object.entries(args.select || args.include || {}) as [string, any][]) {
        if (!value) continue
        if (key === '_count') {
            const counts: Row = {}
            for (const field of Object.values(model.fields).filter(field => field.relation)) {
                const count = value === true || value.select?.[field.name]
                if (count) counts[field.name] = related(state, model, row, field).filter(item => matches(state, localModels()[field.type], item, count.where)).length
            }
            result[key] = counts
        } else {
            const field = model.fields[key]
            if (!field) throw new Error(`Unknown local selection: ${model.name}.${key}`)
            if (!field.relation) result[key] = row[key]
            else {
                const target = localModels()[field.type]
                const items = queryRows(state, target, value === true ? {} : value, related(state, model, row, field)).map(item => select(state, target, item, value === true ? {} : value))
                result[key] = field.list ? items : (items[0] ?? null)
            }
        }
    }
    return clone(result)
}
function validateUnique(state: State, model: LocalModel, candidate: Row, except?: Row) {
    for (const keys of model.unique) {
        if (keys.some(key => candidate[key] == null)) continue
        if (rows(state, model).some(row => row !== except && keys.every(key => compare(row[key], candidate[key]) === 0))) error('P2002', `Local record already exists: ${model.name}.${keys.join('_')}`)
    }
}
function updateData(model: LocalModel, row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue
        const field = model.fields[key]
        if (!field || field.relation) throw new Error(`Unsupported local write field: ${model.name}.${key}`)
        if (field.type !== 'Json' && plain(value)) {
            if (own(value, 'set')) row[key] = convert(field, value.set)
            else if (own(value, 'increment') || own(value, 'decrement')) {
                const operand = own(value, 'increment') ? value.increment : value.decrement
                const sign = own(value, 'increment') ? 1 : -1
                if (field.type === 'Decimal') row[key] = new Prisma.Decimal(row[key] ?? 0).plus(new Prisma.Decimal(operand).mul(sign))
                else if (field.type === 'BigInt') row[key] = BigInt(row[key] ?? 0) + BigInt(operand) * BigInt(sign)
                else row[key] = Number(row[key] ?? 0) + Number(operand) * sign
            } else throw new Error(`Unsupported local update: ${key}`)
        } else row[key] = clone(convert(field, value))
        if (row[key] === null && !field.optional) throw new Error(`Local field is required: ${model.name}.${key}`)
    }
    for (const field of Object.values(model.fields)) if (field.updatedAt && !own(data, field.name)) row[field.name] = new Date()
}
function create(state: State, model: LocalModel, data: Row): Row {
    const row: Row = {}
    for (const field of Object.values(model.fields).filter(field => !field.relation)) {
        if (field.defaultValue === 'now()') row[field.name] = new Date()
        else if (field.defaultValue === 'autoincrement()') row[field.name] = rows(state, model).reduce((max, item) => (BigInt(item[field.name]) > max ? BigInt(item[field.name]) : max), 0n) + 1n
        else if (field.defaultValue !== undefined) row[field.name] = convert(field, JSON.parse(field.defaultValue))
        else row[field.name] = null
    }
    updateData(model, row, data)
    for (const field of Object.values(model.fields)) if (!field.relation && !field.optional && row[field.name] === null) throw new Error(`Local field is required: ${model.name}.${field.name}`)
    validateUnique(state, model, row)
    rows(state, model).push(row)
    return row
}
function execute(state: State, model: LocalModel, method: string, args: Row = {}): any {
    const selected = queryRows(state, model, args)
    if (method === 'findMany') return selected.map(row => select(state, model, row, args))
    if (['findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow'].includes(method)) {
        if (!selected[0] && method.endsWith('OrThrow')) error('P2025', `Local record not found: ${model.name}`)
        return selected[0] ? select(state, model, selected[0], args) : null
    }
    if (method === 'count') return selected.length
    if (method === 'aggregate') {
        const aggregate: Row = {}
        for (const mode of ['_sum', '_min', '_max', '_avg', '_count']) {
            if (!args[mode]) continue
            if (mode === '_count' && args[mode] === true) {
                aggregate[mode] = selected.length
                continue
            }
            aggregate[mode] = {}
            for (const key of Object.keys(args[mode])) {
                const values = selected.map(row => row[key]).filter(value => value != null)
                aggregate[mode][key] =
                    mode === '_count'
                        ? values.length
                        : !values.length
                          ? null
                          : mode === '_min'
                            ? values.sort(compare)[0]
                            : mode === '_max'
                              ? values.sort(compare).at(-1)
                              : values.reduce((sum, value) => new Prisma.Decimal(sum).plus(value), new Prisma.Decimal(0))
                if (mode === '_avg' && values.length) aggregate[mode][key] = aggregate[mode][key].div(values.length)
                if (model.fields[key]?.type !== 'Decimal' && Prisma.Decimal.isDecimal(aggregate[mode][key])) aggregate[mode][key] = aggregate[mode][key].toNumber()
            }
        }
        return aggregate
    }
    if (method === 'create') return select(state, model, create(state, model, args.data), args)
    if (method === 'createMany') {
        let count = 0
        for (const data of Array.isArray(args.data) ? args.data : [args.data]) {
            try {
                create(state, model, data)
                count++
            } catch (cause) {
                if (!args.skipDuplicates || (cause as { code?: string }).code !== 'P2002') throw cause
            }
        }
        return { count }
    }
    if (method === 'upsert') return selected.length ? execute(state, model, 'update', { ...args, data: args.update }) : select(state, model, create(state, model, args.create), args)
    if (method === 'update' || method === 'updateMany') {
        const targets = method === 'update' ? selected.slice(0, 1) : selected
        if (method === 'update' && !targets.length) error('P2025', `Local record not found: ${model.name}`)
        for (const row of targets) {
            const next = clone(row)
            updateData(model, next, args.data)
            validateUnique(state, model, next, row)
            Object.assign(row, next)
        }
        return method === 'update' ? select(state, model, targets[0], args) : { count: targets.length }
    }
    if (method === 'delete' || method === 'deleteMany') {
        const targets = method === 'delete' ? selected.slice(0, 1) : selected
        if (method === 'delete' && !targets.length) error('P2025', `Local record not found: ${model.name}`)
        const result = method === 'delete' ? select(state, model, targets[0], args) : { count: targets.length }
        state.collections[model.name] = rows(state, model).filter(row => !targets.includes(row))
        return result
    }
    throw new Error(`Unsupported local record operation: ${model.name}.${method}`)
}
class LocalOperation implements PromiseLike<any> {
    private promise?: Promise<any>
    constructor(private readonly run: () => Promise<any>) {}
    then<TResult1 = any, TResult2 = never>(fulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, rejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) {
        return (this.promise ??= this.run()).then(fulfilled, rejected)
    }
    catch(rejected: (reason: any) => any) {
        return this.then(undefined, rejected)
    }
    finally(callback: () => void) {
        return this.then().finally(callback)
    }
}
export function createLocalFileClient(): PrismaClient {
    const client = new Proxy(
        {},
        {
            get(_target, name: string) {
                if (typeof name !== 'string' || name === 'then') return undefined
                if (name === '$disconnect' || name === '$connect') return async () => {}
                if (name === '$transaction')
                    return async (operation: any) => {
                        const run = async () =>
                            typeof operation === 'function'
                                ? operation(client)
                                : await operation.reduce(async (previous: Promise<any[]>, next: any) => [...(await previous), await next], Promise.resolve([]))
                        return transact(run)
                    }
                if (name.startsWith('$')) throw new Error(`Database operation is unavailable in local-file mode: ${name}`)
                const model = Object.values(localModels()).find(model => model.name[0].toLowerCase() + model.name.slice(1) === name)
                if (!model) throw new Error(`Unknown local collection: ${name}`)
                return new Proxy(
                    {},
                    {
                        get(_delegate, method: string) {
                            if (typeof method !== 'string' || method === 'then') return undefined
                            return (args?: Row) =>
                                new LocalOperation(async () => {
                                    const mutation = !['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'count', 'aggregate'].includes(method)
                                    const perform = async () => {
                                        const active = context.getStore()
                                        if (active?.closed) throw new Error('Local file transaction is already closed')
                                        const state = active?.state ?? (await read(localDataDirectory()))
                                        const before = mutation ? clone(state) : undefined
                                        try {
                                            const result = execute(state, model, method, args)
                                            if (mutation && active) active.dirty = true
                                            return result
                                        } catch (cause) {
                                            if (before && active) active.state = before
                                            throw cause
                                        }
                                    }
                                    return mutation && !context.getStore() ? transact(perform) : perform()
                                })
                        }
                    }
                )
            }
        }
    ) as PrismaClient
    return client
}
async function transact<T>(work: () => Promise<T>): Promise<T> {
    const directory = localDataDirectory()
    const active = context.getStore()
    if (active) {
        if (active.closed || active.directory !== directory) throw new Error('Invalid local file transaction context')
        return work()
    }
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    let compromised: Error | undefined
    const release = await lockfile.lock(directory, {
        realpath: true,
        stale: 30_000,
        update: 5_000,
        retries: { retries: 400, minTimeout: 25, maxTimeout: 100, factor: 1 },
        onCompromised: cause => {
            compromised = cause
        }
    })
    let transaction: Context | undefined
    try {
        transaction = { directory, state: await read(directory), dirty: false, closed: false }
        const result = await context.run(transaction, work)
        if (compromised) throw compromised
        if (transaction.dirty) await write(directory, transaction.state)
        return result
    } finally {
        if (transaction) transaction.closed = true
        await release()
    }
}

/** Admission callers already run inside the serialized file transaction. */
export async function localTransactionLock(name: string): Promise<Array<{ acquired: number }>> {
    const active = context.getStore()
    if (!active || active.closed) throw new Error(`Local transaction is required for ${name}`)
    return [{ acquired: 1 }]
}
