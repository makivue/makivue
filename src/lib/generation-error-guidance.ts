export type GenerationErrorKind =
    | 'content_safety'
    | 'image_recovery_exhausted'
    | 'dialogue_too_long'
    | 'reference_video_too_long'
    | 'input_download'
    | 'script_quality'
    | 'translation'
    | 'storage_permission'
    | 'credentials'
    | 'queue_full'
    | 'rate_limit'
    | 'temporary_upstream'
    | 'executor_interrupted'
    | 'unknown'

type GenerationEditTarget = 'image_prompt' | 'dialogue' | 'chapter'

export type GenerationErrorGuidance = {
    kind: GenerationErrorKind
    title: string
    summary: string
    nextStep: string
    editTarget?: GenerationEditTarget
    retryable: boolean
    adminRequired: boolean
    configurationIssue?: 'missing' | 'invalid' | 'permission'
}

export function getGenerationErrorGuidance(errorMessage: string): GenerationErrorGuidance {
    const message = errorMessage.trim()

    if (/Failed to download|ImageTooLarge|视频参考图(?:读取失败|超过|压缩后仍超过|仅支持)/i.test(message)) {
        return {
            kind: 'input_download',
            title: '视频参考素材读取失败',
            summary: '视频服务未能读取输入素材，可能是图片超过大小限制或素材地址无法访问。已生成的插图仍会保留。',
            nextStep: '请检查参考素材大小及访问地址，处理后重试当前视频；无需重新生成整集。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/video duration \(seconds\)[\s\S]*less than or equal to\s*[\d.]+[\s\S]*r2v|参考视频[\s\S]*(?:超过|不能短于|不能超过|合计不能超过)\s*[\d.]+\s*秒/i.test(message)) {
        const seedance25EncodingTolerance = /less than or equal to\s*30\.2[\s\S]*doubao-seedance-2-5[\s\S]*r2v/i.test(message)
        return {
            kind: 'reference_video_too_long',
            title: '参考视频时长超出限制',
            summary: seedance25EncodingTolerance
                ? 'Seedance 2.5 的参考视频业务范围为单条 2–30 秒；错误中的 30.2 秒是上游编码容差，不是可上传上限。'
                : '当前模型对参考视频的单条或合计时长有限制；输出视频时长设置不会自动缩短输入素材。',
            nextStep: '请按上传区标注的范围调整参考视频，删除原素材并重新上传，再生成当前视频。',
            retryable: false,
            adminRequired: false
        }
    }

    if (/剧本质量检查未通过：[\s\S]*按对白语速和可见动作估算[仅约]\s*[\d.]+\s*秒，[\s\S]*明显(?:低于|超过)/i.test(message)) {
        return {
            kind: 'script_quality',
            title: '上次拆本因估算时长暂停',
            summary: '上次结果因估算时长偏离目标而未保存。现在整集时长仅作提示，通过其他质量检查后即可保存并继续。',
            nextStep: '请重新拆本集或点击“拆剩余剧本”继续，无需为了凑时长修改章节。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/生成队列(?:已满|等待超时)|队列上限|队列已满|排队等待超过/i.test(message)) {
        const label = message.includes('图片') ? '图片' : message.includes('音频') ? '音频' : '视频'
        return {
            kind: 'queue_full',
            title: `${label}生成队列已满`,
            summary: '当前账号的生成队列暂时没有空位，任务尚未提交给模型，这不是素材或提示词错误。',
            nextStep: '一键生成会定时等待空位并自动继续；如果等待超时，请稍后再次继续未完成镜头。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/正在等待演员完成真人认证|尚未完成真人认证|本镜没有关联角色|已完成真人认证，但还没有可用素材|真人素材自动同步未完成/i.test(message)) {
        return {
            kind: 'content_safety',
            title: '旧版真人认证提示已失效',
            summary: '当前画面使用的是虚构角色，不需要真人认证。系统会把分镜图片上传到官方 AIGC 素材库后，在当前视频模型内重试。',
            nextStep: '请直接重新生成当前步骤；无需前往角色页面认证，也不会自动切换视频模型。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/真人素材正在进行一致性校验|等待素材.*(?:审核|校验)|素材已提交，正在进行一致性校验/i.test(message)) {
        return {
            kind: 'content_safety',
            title: '真人素材仍在审核',
            summary: '真人认证已经完成，但定稿素材尚未通过一致性校验，因此暂时还不能用于视频生成。',
            nextStep: '请等待项目“角色”页面显示素材可用后，再重试未完成视频；无需重新生成插图。',
            retryable: false,
            adminRequired: false
        }
    }

    if (/真人素材一致性校验未通过/i.test(message)) {
        return {
            kind: 'content_safety',
            title: '真人素材审核未通过',
            summary: '角色认证已完成，但上传的定稿图没有通过真人素材一致性校验。',
            nextStep: '请到项目“角色”页面更换清晰的多视图角色设定板或面部特写并重新同步；显示可用后再重试视频。',
            editTarget: 'image_prompt',
            retryable: false,
            adminRequired: false
        }
    }

    if (/真人认证素材对当前视频服务账号不可用|素材组和视频接入点属于同一个/i.test(message)) {
        return {
            kind: 'credentials',
            title: '真人素材与视频服务配置不一致',
            summary: '素材已经通过认证，但素材所属项目与当前视频接入点不一致，因此视频服务无法读取该素材。',
            nextStep: '请管理员确认真人认证、素材组和视频接入点属于同一个火山方舟项目。',
            retryable: false,
            adminRequired: true
        }
    }

    if (/任务租约过期|自动回收|实例心跳中断|服务(?:实例)?.*重启|服务实例.*中断|发布.*重启|未找到可恢复的上游任务检查点/i.test(message)) {
        return {
            kind: 'executor_interrupted',
            title: '生成服务中断，当前任务未完成',
            summary: '任务在生成结果写入分镜前遇到服务重启；已完成的插图和分镜仍会保留，这不是视频模型拒绝了内容。',
            nextStep: '请等待当前发布完成后，点击“重新生成当前步骤”；无需修改提示词或重新制作整集。',
            retryable: true,
            adminRequired: false
        }
    }

    if (
        /Wan\s*2\.7[\s\S]*最多支持\s*15\s*秒[\s\S]*当前台词|自动加速会超过自然语速范围|audio.{0,40}(?:exceeds|longer than).{0,40}15\s*(?:seconds?|s)\b|dialogue.{0,40}(?:too long|duration limit)/i.test(
            message
        )
    ) {
        return {
            kind: 'dialogue_too_long',
            title: '台词需要自动拆镜',
            summary: '这段对白超过 Wan 单镜的自然承载范围，盲目重试仍会失败；系统可以按语义拆成相邻连续镜头，台词不会被截断。',
            nextStep: '点击“自动拆镜”，系统会保留第一镜现有首图，并为新增镜头延续人物、服装、场景和动作状态。',
            retryable: false,
            adminRequired: false
        }
    }

    if (/bucket acl|no right to access this object|assumerole|storage.*(?:accessdenied|上传.*失败)|accessdenied.*(?:bucket|object)/i.test(message)) {
        return {
            kind: 'storage_permission',
            title: '平台存储暂时不可用',
            summary: '素材已经生成或正在上传，但模型供应商拒绝了素材访问请求。这不是提示词或素材内容的问题。',
            nextStep: '无需修改分镜，也不要连续重试。请管理员恢复 Bucket/RAM 写入权限后，再重新生成当前步骤。',
            retryable: false,
            adminRequired: true
        }
    }

    if (/自动转换为.*失败|台词语言转换暂时未完成|translation was empty|返回了空翻译|翻译被截断|wrong language|语言不符.*不完整/i.test(message)) {
        return {
            kind: 'translation',
            title: '台词语言转换未完成',
            summary: '系统已尝试主翻译、备用翻译和安全语义降级，但本次仍未得到完整目标语言台词；视频尚未提交。',
            nextStep: '台词正常时稍后重新生成即可；仍失败时可调整视频原声语言，无需关注内部模型信息。',
            editTarget: 'dialogue',
            retryable: true,
            adminRequired: false
        }
    }

    if (/图片自动恢复失败[\s\S]*(?:api key|not configured|凭证|权限|模型未找到)|备用模型[\s\S]*(?:api key|not configured|凭证|权限|模型未找到)/i.test(message)) {
        return {
            kind: 'image_recovery_exhausted',
            title: '备用图片模型尚未配置',
            summary: '系统已经自动改写提示词并切换备用图片模型，不需要继续进行相同条件下的盲目重试。',
            nextStep: '展开技术详情确认备用模型原因；如果不是平台配置问题，请调整图像描述后再生成当前镜头。',
            retryable: false,
            adminRequired: true
        }
    }

    if (/备用模型已生成图片，但[\s\S]*(?:一致性|连续性)检查|IMAGE_RECOVERY_EXHAUSTED/i.test(message)) {
        return {
            kind: 'image_recovery_exhausted',
            title: '备用图片未通过一致性检查',
            summary: '系统已经切换备用模型并生成了图片，但人物、服装、场景或镜头连续性低于当前质量门槛，因此没有把低质量画面写入分镜。',
            nextStep: '请检查图像描述中的人物、服装和场景是否互相冲突；调整后重新生成当前镜头。',
            editTarget: 'image_prompt',
            retryable: false,
            adminRequired: false
        }
    }

    if (/虚构角色图片已上传官方 AIGC 素材库，但视频服务仍判定画面包含真人特征/i.test(message)) {
        return {
            kind: 'content_safety',
            title: '官方素材重试后仍被拦截',
            summary: '系统已经完成官方 AIGC 素材入库，并在当前模型内重试；服务仍把这张虚构角色图片误判为真人。',
            nextStep: '无需真人认证。请降低当前插图的人脸照片写实感，或重新生成插图后再生成视频。',
            editTarget: 'image_prompt',
            retryable: false,
            adminRequired: false
        }
    }

    if (/InputImageSensitiveContentDetected\.PrivacyInformation|PrivacyInformation|SensitiveContentDetected|input image may contain real person|当前首帧触发真人隐私审核/i.test(message)) {
        return {
            kind: 'content_safety',
            title: '虚构角色素材需要重新提交',
            summary: '这是旧版本保存的隐私审核错误。当前版本会自动把分镜图片上传到官方 AIGC 素材库，并保持当前视频模型重试。',
            nextStep: '请直接重新生成当前步骤，无需真人认证。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/图片自动恢复失败|备用模型.*(?:未完成生成|失败)/i.test(message)) {
        return {
            kind: 'image_recovery_exhausted',
            title: '图片自动恢复未完成',
            summary: '系统已经自动改写提示词并切换备用图片模型，不需要继续进行相同条件下的盲目重试。',
            nextStep: '展开技术详情确认备用模型原因；如果不是平台配置问题，请调整图像描述后再生成当前镜头。',
            editTarget: 'image_prompt',
            retryable: false,
            adminRequired: false
        }
    }

    if (
        /promptFeedback.*blockReason.*SAFETY|blockReason["=: ]+SAFETY|IMAGE_SAFETY|PROHIBITED_CONTENT|usage guidelines|safety filter|安全过滤|安全改写.*仍被拦截|No image in Banana response.*(?:SAFETY|NO_IMAGE)/i.test(
            message
        )
    ) {
        return {
            kind: 'content_safety',
            title: '图片内容安全检查未通过',
            summary: '系统会自动改写提示词；名牌、徽章、臂章和制服标识会被保留，不会作为需要删除的内容。',
            nextStep: '如果自动恢复仍失败，请定位图像描述，只调整人物年龄、裸露、血腥伤害或危险动作等真正可能触发限制的表达。',
            editTarget: 'image_prompt',
            retryable: false,
            adminRequired: false
        }
    }

    if (/credentials|凭证|api[ _-]?key|AK\/SK|permission_denied|unauthenticated|权限不足|模型未找到|model.*not found|模型未配置|模型配置无效|模型无访问权限|Kling.*尚未配置/i.test(message)) {
        const missing = /未配置|尚未配置|not configured|credentials? not found|missing.{0,30}(?:api[ _-]?key|credentials?)/i.test(message)
        const permission = !missing && /permission_denied|权限不足|无访问权限|forbidden/i.test(message)
        return {
            kind: 'credentials',
            configurationIssue: missing ? 'missing' : permission ? 'permission' : 'invalid',
            title: missing ? '模型未配置' : permission ? '模型无访问权限' : '模型配置无效',
            summary: missing ? '当前所选模型尚未配置服务凭证，暂时无法生成。' : permission ? '当前配置的账号没有权限使用所选模型。' : '当前模型的凭证、模型名称或服务区域配置无效。',
            nextStep: '请联系管理员完成模型配置，或选择其他已配置的模型后重试。',
            retryable: false,
            adminRequired: true
        }
    }

    if (/global_price_route_exhausted|No available image provider for model/i.test(message)) {
        return {
            kind: 'temporary_upstream',
            title: '当前图片模型暂无可用线路',
            summary: 'HiModels 当前没有可承接该模型的供应线路；系统已保持所选模型重试，没有改用其他模型，分镜内容本身没有问题。',
            nextStep: '稍后重新生成当前插图；如果持续出现，请管理员检查 HiModels 的价格路由和该模型供应商库存。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/429|throttl|rate.?limit|请求过于频繁|限流/i.test(message)) {
        return {
            kind: 'rate_limit',
            title: '生成服务当前繁忙',
            summary: '请求已被供应商限流，分镜内容本身没有问题。',
            nextStep: '等待几十秒后重试当前步骤；不需要重复修改或重新创建分镜。',
            retryable: true,
            adminRequired: false
        }
    }

    if (/timeout|timed out|fetch failed|econnreset|socket|502|503|504|暂时不可用|网络/i.test(message)) {
        return {
            kind: 'temporary_upstream',
            title: '生成服务连接中断',
            summary: '上游服务或网络暂时中断，本次任务没有正常完成。',
            nextStep: '稍后重试当前步骤即可；如果连续出现，再联系管理员检查供应商状态。',
            retryable: true,
            adminRequired: false
        }
    }

    return {
        kind: 'unknown',
        title: '当前步骤生成失败',
        summary: '系统保留了已完成的素材，不需要从头重新制作整集。',
        nextStep: '检查下方技术详情后重试当前步骤；重复失败时将详情提供给管理员排查。',
        retryable: true,
        adminRequired: false
    }
}
