type SavedJobStatus = {
    phase?: string
    checkpointAvailable?: boolean
}

/** Restart only a saved, unrecoverable failure, never a failure from this attempt. */
export function shouldRestartSavedExtraction(restoring: boolean, httpStatus: number, status: SavedJobStatus | undefined): boolean {
    if (!restoring) return false
    if (httpStatus === 404) return true
    return httpStatus >= 200 && httpStatus < 300 && status?.phase === 'error' && status.checkpointAvailable !== true
}
