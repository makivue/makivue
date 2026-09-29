import { createHash, randomInt } from 'node:crypto'
import { hostname } from 'node:os'

const MIN_MACHINE_ID = 0
const MAX_MACHINE_ID = 65_535
const DEFAULT_NODE_RANGE_START = 32_768

type SonyflakeEnvironment = Partial<
    Record<'SONYFLAKE_MACHINE_ID' | 'SONYFLAKE_DERIVE_FROM_INSTANCE' | 'SONYFLAKE_NODE_MACHINE_ID_MIN' | 'SONYFLAKE_NODE_MACHINE_ID_MAX' | 'POD_UID' | 'POD_NAME' | 'HOSTNAME' | 'NODE_ENV', string>
>

export interface SonyflakeMachineIdResolution {
    machineId: number
    source: 'configured' | 'instance-derived' | 'random'
}

interface SonyflakeRuntime {
    hostname: () => string
    pid: number
    randomInt: (min: number, max: number) => number
}

function optionalMachineId(value: string | undefined, name: string): number | undefined {
    if (value === undefined || value.trim() === '') return undefined
    if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer between ${MIN_MACHINE_ID} and ${MAX_MACHINE_ID}`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < MIN_MACHINE_ID || parsed > MAX_MACHINE_ID) {
        throw new Error(`${name} must be an integer between ${MIN_MACHINE_ID} and ${MAX_MACHINE_ID}`)
    }
    return parsed
}

function shouldDeriveFromInstance(env: SonyflakeEnvironment) {
    if (env.SONYFLAKE_DERIVE_FROM_INSTANCE === 'true') return true
    if (env.SONYFLAKE_DERIVE_FROM_INSTANCE === 'false') return false
    return env.NODE_ENV === 'production'
}

/**
 * Production Node instances derive a process-specific value in the upper half
 * of the Sonyflake machine-id space. Reserve 0..32767 for Go/other services.
 */
export function resolveSonyflakeMachineId(env: SonyflakeEnvironment = process.env, runtime: SonyflakeRuntime = { hostname, pid: process.pid, randomInt }): SonyflakeMachineIdResolution {
    const configured = optionalMachineId(env.SONYFLAKE_MACHINE_ID, 'SONYFLAKE_MACHINE_ID')
    if (!shouldDeriveFromInstance(env)) {
        return configured === undefined ? { machineId: runtime.randomInt(MIN_MACHINE_ID, MAX_MACHINE_ID + 1), source: 'random' } : { machineId: configured, source: 'configured' }
    }

    const rangeStart = optionalMachineId(env.SONYFLAKE_NODE_MACHINE_ID_MIN, 'SONYFLAKE_NODE_MACHINE_ID_MIN') ?? DEFAULT_NODE_RANGE_START
    const rangeEnd = optionalMachineId(env.SONYFLAKE_NODE_MACHINE_ID_MAX, 'SONYFLAKE_NODE_MACHINE_ID_MAX') ?? MAX_MACHINE_ID
    if (rangeStart > rangeEnd) throw new Error('SONYFLAKE_NODE_MACHINE_ID_MIN must not exceed SONYFLAKE_NODE_MACHINE_ID_MAX')

    const instanceIdentity = env.POD_UID?.trim() || env.POD_NAME?.trim() || env.HOSTNAME?.trim() || runtime.hostname()
    if (!instanceIdentity) throw new Error('Sonyflake instance derivation requires POD_UID, POD_NAME, HOSTNAME, or an OS hostname')
    const seed = `${configured ?? 'node'}:${instanceIdentity}:${runtime.pid}`
    const digest = createHash('sha256').update(seed).digest()
    const rangeSize = rangeEnd - rangeStart + 1
    return {
        machineId: rangeStart + (digest.readUInt32BE(0) % rangeSize),
        source: 'instance-derived'
    }
}
