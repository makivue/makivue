import { localizedPrivateMetadata } from '@/i18n/metadata'
import AnimeStudio from './AnimeStudio'

export function generateMetadata() {
    return localizedPrivateMetadata('漫剧与二次元创作', '从角色设定到分镜与成片，创作你的原创动画。')
}

export default function Page() {
    return <AnimeStudio />
}
