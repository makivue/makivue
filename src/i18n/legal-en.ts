import { SITE_NAME } from '@/lib/seo'

export type LegalSection = {
    id?: string
    title: string
    body: string
    paragraphs?: string[]
    bullets?: string[]
    notice?: { title: string; paragraphs: string[] }
    subsections?: LegalSection[]
}
export type LegalContent = { intro: string; sections: LegalSection[] }

export const PRIVACY_POLICY_EN: LegalContent = {
    intro: `${SITE_NAME} runs on your computer. Projects and generated media are saved in your local data directory.`,
    sections: [
        {
            id: 'local-data',
            title: 'Local data and preferences',
            body: 'Stories, prompts, characters, scenes, tasks and generated assets are stored by the local application. Browser storage remembers your language, theme, profile and ongoing work. The application does not require an online account.'
        },
        {
            id: 'model-requests',
            title: 'Requests to model suppliers',
            body: 'When you start a generation task, the local server sends the required prompts, references and settings directly to the model supplier you selected, using credentials you provide. Suppliers may retain inputs and outputs according to their own terms. Review those terms before sending private material. Generated media is copied into your local data directory.'
        },
        {
            id: 'credentials',
            title: 'Your credentials',
            body: 'Keep your own model keys in the ignored environment file or an external credential file. They are used by the local server and are not part of project settings. Do not share these files or include keys, private prompts or personal media in public issue reports.'
        },
        {
            id: 'retention',
            title: 'Control and deletion',
            body: 'You control the local installation, its data directory and backups. Deleting browser storage removes browser preferences, but does not delete project files on disk. Removing local files does not delete content already sent to a supplier; use that supplier’s controls for those requests.'
        }
    ]
}
export const TERMS_OF_USE_EN: LegalContent = {
    intro: `${SITE_NAME} is a local creation tool. You operate the installation and choose the model suppliers you use.`,
    sections: [
        {
            id: 'ownership',
            title: 'Content and permissions',
            body: 'Use only material you have permission to process. You are responsible for checking copyright, image, voice and other rights before sharing generated work. Saving a project locally does not publish it or grant distribution rights to a platform operator.'
        },
        {
            id: 'supplier-costs',
            title: 'Model accounts and costs',
            body: 'Provide your own credentials for each supplier you use. Model requests may incur charges in that supplier account, including charges for failed or repeated requests under its terms. This application does not sell credits or process payments.'
        },
        {
            id: 'review',
            title: 'Review and backups',
            body: 'Generated content may contain mistakes or unsuitable material. Review the results before use, keep backups of important local files and secure access to your computer. The local service is intended for personal use on the loopback address.'
        }
    ]
}
