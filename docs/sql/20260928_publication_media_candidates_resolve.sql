-- 修复失败的 Prisma migration 记录（仅 DML）。
-- 仅在两个新字段已成功创建后单独执行。

UPDATE `_prisma_migrations`
SET `checksum` = '6ed699763cc66313cf74fc05a01a08371002d9e1a77c8a5a0dbe2ea1f0294c34',
    `finished_at` = COALESCE(`finished_at`, CURRENT_TIMESTAMP(3)),
    `applied_steps_count` = 1,
    `logs` = NULL
WHERE `migration_name` = '20260928040000_add_publication_media_candidates'
  AND `finished_at` IS NULL
  AND `rolled_back_at` IS NULL;
