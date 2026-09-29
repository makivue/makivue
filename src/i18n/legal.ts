import { PRIVACY_POLICY_EN, TERMS_OF_USE_EN, type LegalContent } from './legal-en'

export type LegalDocument = 'privacy' | 'terms' | 'cookies'
export const LEGAL_CONTENT: Record<'en' | 'zh', Record<LegalDocument, LegalContent>> = {
    en: {
        privacy: PRIVACY_POLICY_EN,
        terms: TERMS_OF_USE_EN,
        cookies: {
            intro: 'Browser storage supports the local workspace and remembers your preferences.',
            sections: [
                {
                    title: 'Language and appearance',
                    body: 'NEXT_LOCALE remembers your language for up to one year. Local browser storage keeps the selected language and theme until you change or clear them.'
                },
                { title: 'Workspace preferences', body: 'Your local profile, task references and editor preferences support ongoing work on this computer. No online sign-in is required.' },
                {
                    title: 'Browser controls',
                    body: 'You can clear cookies and site storage through your browser. This resets browser preferences but does not remove projects or media from the application data directory.'
                }
            ]
        }
    },
    zh: {
        privacy: {
            intro: '本应用运行在你的电脑上。项目记录与生成素材保存在本地数据目录。',
            sections: [
                { id: 'local-data', title: '本地数据与偏好', body: '故事、提示词、角色、场景、任务及生成素材由本地应用保存。浏览器存储记住语言、主题、本地个人资料和进行中的工作，无需在线账号。' },
                {
                    id: 'model-requests',
                    title: '直连模型供应商',
                    body: '发起生成任务时，本地服务使用你填写的凭证，将必要的提示词、参考素材和设置直接发送给所选模型供应商。供应商可能按其条款保留输入和输出，提交私人素材前请先阅读相关条款。生成素材会复制到本地数据目录。'
                },
                {
                    id: 'credentials',
                    title: '个人凭证',
                    body: '模型密钥应保存在被 Git 忽略的环境文件或仓库外的凭证文件中，由本地服务使用，不写入项目设置。不要分享这些文件，也不要在公开反馈中提交密钥、私人提示词或个人素材。'
                },
                {
                    id: 'retention',
                    title: '管理与删除',
                    body: '你可以管理本地安装、数据目录与备份。清理浏览器存储只会移除浏览器偏好，不会删除磁盘上的项目。删除本地文件也不会删除已发送给供应商的内容，后者需要使用供应商提供的管理渠道。'
                }
            ]
        },
        terms: {
            intro: '本应用是本地创作工具。你负责运行自己的安装，并选择使用的模型供应商。',
            sections: [
                {
                    id: 'ownership',
                    title: '内容与授权',
                    body: '请仅处理有权使用的素材。分享生成作品前，需要自行确认版权、肖像、声音等权利。将项目保存到本地不会自动发布作品，也不会向平台运营方授予分发权。'
                },
                {
                    id: 'supplier-costs',
                    title: '模型账号与费用',
                    body: '每个使用者填写自己对应供应商的凭证。模型请求可能产生供应商费用，失败或重复请求是否收费以供应商条款为准。本应用不销售积分或处理支付。'
                },
                { id: 'review', title: '结果审核与备份', body: '生成内容可能有错误或不适当之处，使用前请检查。请备份重要本地文件并保护电脑访问权限。本地服务用于个人通过回环地址访问。' }
            ]
        },
        cookies: {
            intro: '浏览器存储用于支持本地工作区并记住你的偏好。',
            sections: [
                { title: '语言与外观', body: 'NEXT_LOCALE 最长记住语言一年。浏览器本地存储保存所选语言和主题，直到你修改或清理。' },
                { title: '工作区偏好', body: '本地个人资料、任务引用和编辑偏好用于继续当前电脑上的工作，无需在线登录。' },
                { title: '浏览器控制', body: '可以通过浏览器清除 Cookie 和站点存储。这会重置浏览器偏好，但不会删除应用数据目录中的项目或素材。' }
            ]
        }
    }
}
