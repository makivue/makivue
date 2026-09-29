import { randomUUID } from 'node:crypto'

const GENERATION_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/

/**
 * A retry of one submission keeps its task identity, while a later user
 * action must never inherit an older generation task.
 */
export function resolveGenerationRequestId(value: unknown): string {
    return typeof value === 'string' && GENERATION_REQUEST_ID_PATTERN.test(value) ? value : randomUUID()
}

export function freshGenerationInstruction(requestId: string): string {
    return `FRESH GENERATION REQUEST ${requestId}: generate a new result from this request's prompt and references; do not replay or reuse an earlier generated asset.`
}
