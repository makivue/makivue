'use client'

import { useState } from 'react'
import { ArrowUpRight, CloudUpload, Film, Play, Search } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import UploadsShell, { UploadsState, useUploadedResource, type UploadSummary } from './UploadsShell'
import styles from './Uploads.module.css'

export default function UploadsPage() {
    const { t } = useI18n()
    const resource = useUploadedResource<UploadSummary[]>('/api/drama-uploads')
    const [search, setSearch] = useState('')
    const works = resource.data ?? []
    const filtered = works.filter(work => `${work.title} ${work.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    return (
        <UploadsShell>
            <div className={styles.heading}>
                <div>
                    <p className={styles.eyebrow}>
                        <Film size={15} />
                        {t('上传影视')}
                    </p>
                    <h1>{t('我的上传')}</h1>
                    <p>{t('管理你上传的影视作品')}</p>
                </div>
                <Link
                    href="/upload"
                    className={styles.primary}>
                    <CloudUpload size={18} />
                    {t('上传影视')}
                    <ArrowUpRight size={17} />
                </Link>
            </div>
            <UploadsState {...resource} />
            {resource.data && (
                <>
                    {works.length > 0 && (
                        <div className={styles.toolbar}>
                            <span>{t('共 {count} 部作品', { count: works.length })}</span>
                            <label className={styles.search}>
                                <Search size={17} />
                                <input
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                    placeholder={t('搜索上传作品')}
                                    aria-label={t('搜索上传作品')}
                                />
                            </label>
                        </div>
                    )}
                    {works.length === 0 ? (
                        <div className={styles.state}>
                            <CloudUpload size={38} />
                            <h2>{t('暂无上传作品')}</h2>
                            <Link
                                href="/upload"
                                className={styles.primary}>
                                {t('上传第一部作品')}
                            </Link>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className={styles.state}>{t('没有找到相关作品')}</div>
                    ) : (
                        <div className={styles.grid}>
                            {filtered.map(work => (
                                <Link
                                    key={work.id}
                                    href={`/uploads/${work.id}`}
                                    className={styles.card}>
                                    <div className={styles.cover}>
                                        {work.coverUrl ? (
                                            <OptimizedMediaImage
                                                src={work.coverUrl}
                                                alt={work.title}
                                                fill
                                                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
                                            />
                                        ) : (
                                            <Film size={38} />
                                        )}
                                        <span className={styles.badge}>{t(work.visibility === 'public' ? '已发布' : '私有')}</span>
                                        <span className={styles.play}>
                                            <Play
                                                size={25}
                                                fill="currentColor"
                                            />
                                        </span>
                                        <span className={styles.count}>{t('共 {count} 集', { count: work.episodeCount })}</span>
                                    </div>
                                    <div className={styles.cardBody}>
                                        <h2>{work.title || t('未命名作品')}</h2>
                                        <p>{[work.year, work.genre ? t(work.genre) : null].filter(Boolean).join(' · ')}</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </>
            )}
        </UploadsShell>
    )
}
