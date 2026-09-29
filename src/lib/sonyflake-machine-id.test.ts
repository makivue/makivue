import { describe, expect, it } from 'vitest'
import { resolveSonyflakeMachineId } from './sonyflake-machine-id'

const runtime = (host: string, pid: number, random = 1234) => ({
    hostname: () => host,
    pid,
    randomInt: () => random
})

describe('resolveSonyflakeMachineId', () => {
    it('preserves an explicitly configured id outside clustered runtimes', () => {
        expect(resolveSonyflakeMachineId({ NODE_ENV: 'development', SONYFLAKE_MACHINE_ID: '999' }, runtime('local', 10))).toEqual({ machineId: 999, source: 'configured' })
    })

    it('derives stable Node-range ids and separates pods and processes', () => {
        const env = { NODE_ENV: 'production', SONYFLAKE_MACHINE_ID: '2', POD_UID: 'pod-a' }
        const first = resolveSonyflakeMachineId(env, runtime('host', 1))
        expect(first).toEqual(resolveSonyflakeMachineId(env, runtime('host', 1)))
        expect(first.machineId).toBeGreaterThanOrEqual(32_768)
        expect(first.machineId).toBeLessThanOrEqual(65_535)
        expect(resolveSonyflakeMachineId({ ...env, POD_UID: 'pod-b' }, runtime('host', 1)).machineId).not.toBe(first.machineId)
        expect(resolveSonyflakeMachineId(env, runtime('host', 2)).machineId).not.toBe(first.machineId)
    })

    it('allows deployment-specific reserved ranges', () => {
        const resolved = resolveSonyflakeMachineId(
            { SONYFLAKE_DERIVE_FROM_INSTANCE: 'true', SONYFLAKE_NODE_MACHINE_ID_MIN: '60000', SONYFLAKE_NODE_MACHINE_ID_MAX: '60010', POD_NAME: 'web-2' },
            runtime('host', 1)
        )
        expect(resolved.machineId).toBeGreaterThanOrEqual(60_000)
        expect(resolved.machineId).toBeLessThanOrEqual(60_010)
    })

    it('uses a process-random id only when no configured or derived id applies', () => {
        expect(resolveSonyflakeMachineId({ NODE_ENV: 'development' }, runtime('local', 10, 4567))).toEqual({ machineId: 4567, source: 'random' })
    })

    it('rejects invalid ids and ranges instead of silently masking them', () => {
        expect(() => resolveSonyflakeMachineId({ SONYFLAKE_MACHINE_ID: '-1' }, runtime('local', 1))).toThrow('SONYFLAKE_MACHINE_ID')
        expect(() =>
            resolveSonyflakeMachineId({ SONYFLAKE_DERIVE_FROM_INSTANCE: 'true', SONYFLAKE_NODE_MACHINE_ID_MIN: '500', SONYFLAKE_NODE_MACHINE_ID_MAX: '100', HOSTNAME: 'host' }, runtime('host', 1))
        ).toThrow('must not exceed')
    })
})
