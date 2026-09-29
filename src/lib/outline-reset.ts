import { clientFetch } from './client-fetch'

/** A preparation challenge is never proof that the reset has executed. */
export async function resetOutlineProgress(projectId: string, fetchRequest = clientFetch) {
    const url = `/api/projects/${projectId}/reset-progress`
    const prepare = await fetchRequest(url, { method: 'POST', body: JSON.stringify({}) })
    const prepared = await prepare.json()
    const confirmation = prepared.data?.confirmationRequired ? prepared.data : prepared
    if (!confirmation.confirmationRequired) {
        if (!prepare.ok || !prepared.success) throw new Error(prepared.error ?? '重置项目进度失败')
        return prepared.data
    }
    if (!confirmation.confirmationToken) throw new Error('未取得重置确认信息，请刷新后重试')
    const execute = await fetchRequest(url, { method: 'POST', body: JSON.stringify({ confirmationToken: confirmation.confirmationToken }) })
    const executed = await execute.json()
    if (!execute.ok || !executed.success) throw new Error(executed.error ?? '重置项目进度失败')
    if (executed.confirmationRequired || executed.data?.confirmationRequired) throw new Error('项目进度已变化，尚未清空旧内容，请重新确认')
    return executed.data
}
