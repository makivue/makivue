import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SEO_SOCIAL_IMAGE_COPY } from '@/i18n/seo'
import { SITE_NAME, SITE_ORIGIN, SITE_SOCIAL_IMAGE } from '@/lib/seo'

export const alt = SITE_SOCIAL_IMAGE.alt
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpenGraphImage() {
    const logo = await readFile(join(process.cwd(), 'public/brand/logo.png'), 'base64')

    return new ImageResponse(
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '56px 64px',
                color: '#f8fafc',
                background: 'linear-gradient(125deg, #080812 0%, #21143f 58%, #102d43 100%)',
                fontFamily: 'sans-serif'
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                {/* next/og renders an image directly, not a browser next/image component. */}
                <img
                    src={`data:image/png;base64,${logo}`}
                    alt=""
                    width={84}
                    height={84}
                />
                <div style={{ display: 'flex', fontSize: 58, fontWeight: 700, letterSpacing: '-2px' }}>{SITE_NAME}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 40 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'flex', fontSize: 20, color: '#c4b5fd', letterSpacing: '2px' }}>{SEO_SOCIAL_IMAGE_COPY.category}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-2px' }}>
                        {SEO_SOCIAL_IMAGE_COPY.headline.map(line => (
                            <span key={line}>{line}</span>
                        ))}
                    </div>
                </div>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        width: 380,
                        padding: '36px 30px',
                        border: '1px solid rgba(196,181,253,0.4)',
                        borderRadius: 28,
                        background: 'rgba(196,181,253,0.08)'
                    }}>
                    <span style={{ fontSize: 18, color: '#ddd6fe', letterSpacing: '1px' }}>{SEO_SOCIAL_IMAGE_COPY.storage}</span>
                    <span style={{ fontSize: 106, lineHeight: 1.2, fontWeight: 700, letterSpacing: '-5px', color: '#ede9fe' }}>{SEO_SOCIAL_IMAGE_COPY.storageLabel}</span>
                    <span style={{ marginTop: 8, fontSize: 17, color: '#c4b5fd' }}>{SEO_SOCIAL_IMAGE_COPY.storageNote}</span>
                </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, fontSize: 23, color: '#cbd5e1' }}>
                <span>{SEO_SOCIAL_IMAGE_COPY.capabilities}</span>
                <span style={{ color: '#ddd6fe' }}>{new URL(SITE_ORIGIN).hostname}</span>
            </div>
        </div>,
        size
    )
}
