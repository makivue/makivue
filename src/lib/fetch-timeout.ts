/** Build a hard deadline while preserving an existing cancellation signal. */
export function fetchTimeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
}
