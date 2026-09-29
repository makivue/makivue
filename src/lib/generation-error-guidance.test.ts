import { describe, expect, it } from 'vitest'
import { getGenerationErrorGuidance } from './generation-error-guidance'

describe('generation error guidance', () => {
    it('identifies provider input download failures without hiding them behind an unknown error', () => {
        const guide = getGenerationErrorGuidance('Wan 3.0 task FAILED: InvalidParameter: Failed to download https://cdn.example/frame.png')
        expect(guide).toMatchObject({ kind: 'input_download', title: '视频参考素材读取失败', retryable: true })
        expect(getGenerationErrorGuidance('ImageTooLarge: Maximal size of image supported is 20971520').kind).toBe('input_download')
    })
    it.each(['剧本质量检查未通过：按对白语速和可见动作估算仅 214.9 秒，明显低于 5-8 分钟', '剧本质量检查未通过：按对白语速和可见动作估算约 194.5 秒，明显超过 1-2 分钟'])(
        'offers retry for a saved runtime failure without requiring chapter edits',
        message => {
            const guide = getGenerationErrorGuidance(message)

            expect(guide).toMatchObject({ kind: 'script_quality', retryable: true, adminRequired: false })
            expect(guide.editTarget).toBeUndefined()
            expect(guide.summary).toContain('整集时长仅作提示')
            expect(guide.nextStep).toContain('拆剩余剧本')
        }
    )

    it('turns Banana prompt safety JSON into an editable content error', () => {
        const guide = getGenerationErrorGuidance('No image in Banana response. Raw: {"promptFeedback":{"blockReason":"SAFETY","blockReasonMessage":"The prompt is blocked due to safety"}}')
        expect(guide).toMatchObject({ kind: 'content_safety', editTarget: 'image_prompt', retryable: false, adminRequired: false })
        expect(guide.summary).toContain('名牌、徽章、臂章')
    })

    it('retries a legacy privacy failure through the official AIGC material path without asking for authentication', () => {
        const guide = getGenerationErrorGuidance(
            'Seedance create error: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image may contain real person."}}'
        )
        expect(guide).toMatchObject({ kind: 'content_safety', retryable: true, adminRequired: false })
        expect(guide.title).toBe('虚构角色素材需要重新提交')
        expect(guide.nextStep).toBe('请直接重新生成当前步骤，无需真人认证。')
        expect(`${guide.title}${guide.summary}${guide.nextStep}`).not.toMatch(/Seedance|火山|豆包/i)
    })

    it('explains that portrait verification and material readiness are separate stages', () => {
        const processing = getGenerationErrorGuidance('角色“演员甲”的真人素材正在进行一致性校验。审核通过后重试。')
        expect(processing).toMatchObject({ kind: 'content_safety', title: '真人素材仍在审核', retryable: false })
        expect(processing.nextStep).toContain('无需重新生成插图')

        const unverified = getGenerationErrorGuidance('角色“演员甲”尚未完成真人认证。请在项目“角色”页面点击“开始认证”。')
        expect(unverified).toMatchObject({ kind: 'content_safety', title: '旧版真人认证提示已失效', retryable: true })
        expect(unverified.nextStep).toContain('无需前往角色页面认证')
    })

    it('asks for an image adjustment only after the official AIGC asset retry also fails', () => {
        const guide = getGenerationErrorGuidance(
            '虚构角色官方素材库恢复失败：虚构角色图片已上传官方 AIGC 素材库，但视频服务仍判定画面包含真人特征。无需真人认证，请调整当前插图的人脸写实度后重新生成。'
        )
        expect(guide).toMatchObject({ kind: 'content_safety', title: '官方素材重试后仍被拦截', retryable: false, editTarget: 'image_prompt' })
        expect(guide.nextStep).toContain('无需真人认证')
    })

    it('marks a cross-project portrait asset mismatch as an administrator configuration issue', () => {
        const guide = getGenerationErrorGuidance('真人认证素材对当前视频服务账号不可用。请确认认证、素材组和视频接入点属于同一个火山方舟项目。')
        expect(guide).toMatchObject({ kind: 'credentials', adminRequired: true, retryable: false })
    })

    it('explains that translation failure happened before video submission', () => {
        const guide = getGenerationErrorGuidance('视频台词语言转换暂时未完成，请稍后重试或调整原声语言。')
        expect(guide).toMatchObject({ kind: 'translation', editTarget: 'dialogue', retryable: true })
        expect(guide.summary).toContain('视频尚未提交')
        expect(`${guide.summary}${guide.nextStep}`).not.toMatch(/Gemini|GPT|SAFETY/i)
    })

    it('turns an oversized Wan dialogue failure into an automatic split action instead of a retry loop', () => {
        const guide = getGenerationErrorGuidance('Wan 2.7 单个分镜最多支持 15 秒音频，当前台词为 21.0 秒；自动加速会超过自然语速范围。请缩短台词或拆分分镜，系统不会截断对白。')
        expect(guide).toMatchObject({ kind: 'dialogue_too_long', retryable: false, adminRequired: false })
        expect(guide.nextStep).toContain('自动拆镜')
    })

    it('explains that an overlong r2v input must be trimmed instead of retried', () => {
        const guide = getGenerationErrorGuidance(
            'Seedance create error: {"error":{"code":"InvalidParameter","message":"The parameter video duration (seconds) specified in the request must be less than or equal to 30.2 for model doubao-seedance-2-5 in r2v."}}'
        )

        expect(guide).toMatchObject({ kind: 'reference_video_too_long', retryable: false, adminRequired: false })
        expect(guide.summary).toContain('单条 2–30 秒')
        expect(guide.summary).toContain('30.2 秒是上游编码容差')
    })

    it('does not ask users to retry an local storage permission failure', () => {
        const guide = getGenerationErrorGuidance('storyboards 上传 local storage 失败：You have no right to access this object because of bucket acl.')
        expect(guide).toMatchObject({ kind: 'storage_permission', retryable: false, adminRequired: true })
        expect(guide.nextStep).toContain('不要连续重试')
    })

    it('offers a delayed retry for provider throttling', () => {
        expect(getGenerationErrorGuidance('provider returned 429 rate limit')).toMatchObject({ kind: 'rate_limit', retryable: true, adminRequired: false })
    })

    it('explains an exhausted HiModels price route without suggesting a model switch', () => {
        const guide = getGenerationErrorGuidance(
            'gemini-3.1-flash-image失败（503）：No available image provider for model: gemini-3.1-flash-image, reason=global_price_route_exhausted, skuProviderIds=[3]'
        )

        expect(guide).toMatchObject({ kind: 'temporary_upstream', title: '当前图片模型暂无可用线路', retryable: true, adminRequired: false })
        expect(`${guide.summary}${guide.nextStep}`).toContain('保持所选模型')
        expect(`${guide.summary}${guide.nextStep}`).not.toContain('切换其他模型')
    })

    it('identifies an account queue limit instead of reporting an unknown generation failure', () => {
        const guide = getGenerationErrorGuidance('当前账号已有 20 个视频任务排队，本次还需 1 个名额，队列上限为 20；请等待或取消部分任务后再提交。')
        expect(guide).toMatchObject({ kind: 'queue_full', title: '视频生成队列已满', retryable: true, adminRequired: false })
        expect(guide.summary).toContain('尚未提交给模型')
    })

    it('explains that an expired batch lease is a service interruption rather than a provider rejection', () => {
        const guide = getGenerationErrorGuidance('任务租约过期，已自动回收，请重试')
        expect(guide).toMatchObject({ kind: 'executor_interrupted', retryable: true, adminRequired: false })
        expect(guide.summary).not.toBe(getGenerationErrorGuidance('unclassified provider failure').summary)
    })

    it('recognizes a video task interrupted by a service restart as retryable', () => {
        const guide = getGenerationErrorGuidance('服务重启后未找到可恢复的上游任务检查点，请重新生成')
        expect(guide).toMatchObject({
            kind: 'executor_interrupted',
            title: '生成服务中断，当前任务未完成',
            retryable: true,
            adminRequired: false
        })
        expect(guide.summary).toContain('不是视频模型拒绝')
        expect(guide.nextStep).toContain('重新生成当前步骤')
    })

    it('does not offer a blind retry after the fallback image fails its consistency gate', () => {
        const guide = getGenerationErrorGuidance('备用模型已生成图片，但人物/场景一致性检查未通过（人物身份 51 < 70）。为避免降低当前画面质量，系统未采用这张图片。')
        expect(guide).toMatchObject({ kind: 'image_recovery_exhausted', editTarget: 'image_prompt', retryable: false })
        expect(guide.summary).toContain('没有把低质量画面写入分镜')
    })
})
