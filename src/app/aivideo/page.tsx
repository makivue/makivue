import CreatorWorkspace from '../create/CreatorWorkspace'
import { localizedPrivateMetadata } from '@/i18n/metadata'
import { CREATION_PRODUCTS } from '@/lib/creation-products'

export function generateMetadata() {
    const product = CREATION_PRODUCTS.video
    return localizedPrivateMetadata(product.title, product.description)
}

export default function Page() {
    return <CreatorWorkspace mode="video" />
}
