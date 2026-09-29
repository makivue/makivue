import { SITE_CONTACT_EMAIL } from '@/lib/seo'

export default function ContactEmail({ className }: { className?: string }) {
    return (
        <a
            href={`mailto:${SITE_CONTACT_EMAIL}`}
            className={className}
            data-i18n-skip
            dir="ltr"
            translate="no">
            {SITE_CONTACT_EMAIL}
        </a>
    )
}
