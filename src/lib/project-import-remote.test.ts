import { expect, it, vi } from 'vitest'
import { commitProjectImportRemotely, shouldUseRemoteProjectImport } from './project-import-remote'
it('never forwards project data to a business backend even when legacy configuration is present', async () => {
    vi.stubEnv('TEST_API_PROXY_TARGET', 'https://example.com')
    const transport = vi.spyOn(globalThis, 'fetch')
    try {
        expect(shouldUseRemoteProjectImport()).toBe(false)
        await expect(commitProjectImportRemotely(new Request('http://localhost/api/projects/import'), { jobId: '1' })).rejects.toThrow('disabled')
        expect(transport).not.toHaveBeenCalled()
    } finally { vi.restoreAllMocks(); vi.unstubAllEnvs() }
})
