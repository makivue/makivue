// 63-bit Sonyflake id (compatible with github.com/sony/sonyflake used on the Go side).
// Layout: 39 bits elapsed time in 10ms units | 8 bits sequence | 16 bits machine id.
// Result always fits in a signed BIGINT.
import { resolveSonyflakeMachineId, type SonyflakeMachineIdResolution } from '@/lib/sonyflake-machine-id'

const START_TIME_MS = 1409529600000 // 2014-09-01 UTC — sony/sonyflake default

const BIT_LEN_SEQUENCE = 8n
const BIT_LEN_MACHINE_ID = 16n
const MAX_SEQUENCE = (1n << BIT_LEN_SEQUENCE) - 1n

type SonyflakeProcessState = {
    machineIdResolution: SonyflakeMachineIdResolution
    lastElapsed: bigint
    sequence: bigint
}

// Next.js can reload or evaluate server chunks independently. Keeping the
// sequence on globalThis prevents two copies in one process restarting at 0.
const globalForSonyflake = globalThis as typeof globalThis & { __aiDramaSonyflake?: SonyflakeProcessState }
const sonyflakeState = (globalForSonyflake.__aiDramaSonyflake ??= {
    machineIdResolution: resolveSonyflakeMachineId(),
    lastElapsed: -1n,
    sequence: 0n
})

function elapsed10ms(): bigint {
    return BigInt(Math.floor((Date.now() - START_TIME_MS) / 10))
}

export function genId(): bigint {
    let elapsed = elapsed10ms()
    if (elapsed <= sonyflakeState.lastElapsed) {
        sonyflakeState.sequence = (sonyflakeState.sequence + 1n) & MAX_SEQUENCE
        if (sonyflakeState.sequence === 0n) {
            while (elapsed <= sonyflakeState.lastElapsed) elapsed = elapsed10ms()
        } else elapsed = sonyflakeState.lastElapsed
    } else {
        sonyflakeState.sequence = 0n
    }
    sonyflakeState.lastElapsed = elapsed
    return (elapsed << (BIT_LEN_SEQUENCE + BIT_LEN_MACHINE_ID)) | (sonyflakeState.sequence << BIT_LEN_MACHINE_ID) | BigInt(sonyflakeState.machineIdResolution.machineId)
}

export function getSonyflakeMachineId(): SonyflakeMachineIdResolution {
    return { ...sonyflakeState.machineIdResolution }
}
