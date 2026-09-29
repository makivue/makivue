-- Run this once against the target example_database database before redeploying.
-- It is safe to run again after a partially applied migration.
-- No foreign keys are created because the Aliyun RDS application account has
-- no REFERENCES privilege. Ownership and integrity are enforced by the API.

SET @ddl = IF(
    EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'characters'
          AND column_name = 'seedance_asset_group_id'
    ),
    'SELECT 1',
    'ALTER TABLE `characters` ADD COLUMN `seedance_asset_group_id` VARCHAR(100) NULL'
);
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
    EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'characters'
          AND column_name = 'seedance_portrait_status'
    ),
    'SELECT 1',
    'ALTER TABLE `characters` ADD COLUMN `seedance_portrait_status` VARCHAR(20) NOT NULL DEFAULT ''unverified'''
);
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

CREATE TABLE IF NOT EXISTS `seedance_portrait_sessions` (
    `id` BIGINT NOT NULL,
    `character_id` BIGINT NOT NULL,
    `state` VARCHAR(80) NOT NULL,
    `byted_token` VARCHAR(512) NULL,
    `project_name` VARCHAR(100) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `result_code` VARCHAR(50) NULL,
    `error_msg` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_seedance_portrait_session_state` (`state`),
    INDEX `idx_seedance_portrait_session_character` (`character_id`, `status`),
    INDEX `idx_seedance_portrait_session_expires` (`expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seedance_portrait_assets` (
    `id` BIGINT NOT NULL,
    `character_id` BIGINT NOT NULL,
    `asset_id` VARCHAR(100) NULL,
    `group_id` VARCHAR(100) NOT NULL,
    `project_name` VARCHAR(100) NOT NULL,
    `role` VARCHAR(30) NULL,
    `source_url` VARCHAR(512) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'uploading',
    `error_msg` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_seedance_portrait_asset_id` (`asset_id`),
    UNIQUE INDEX `uk_seedance_portrait_source` (`character_id`, `group_id`, `source_url`),
    INDEX `idx_seedance_portrait_asset_character` (`character_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The failed attempt already has a row in _prisma_migrations. Mark it complete
-- only after all DDL above succeeds, so the existing entrypoint no longer stops
-- on P3009. The checksum matches the corrected repository migration file.
UPDATE `_prisma_migrations`
SET `checksum` = '5b14bda2aa776bd9e548d23a23a66fcb6280b634980fedf0dbada67a8c62964e',
    `finished_at` = COALESCE(`finished_at`, CURRENT_TIMESTAMP(3)),
    `applied_steps_count` = 1,
    `logs` = NULL
WHERE `migration_name` = '20260816_add_seedance_portrait_flow'
  AND `finished_at` IS NULL
  AND `rolled_back_at` IS NULL;

SELECT
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'characters'
       AND column_name IN ('seedance_asset_group_id', 'seedance_portrait_status')) AS character_columns,
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('seedance_portrait_sessions', 'seedance_portrait_assets')) AS portrait_tables,
    (SELECT COUNT(*) FROM `_prisma_migrations`
     WHERE `migration_name` = '20260816_add_seedance_portrait_flow'
       AND `finished_at` IS NULL AND `rolled_back_at` IS NULL) AS unresolved_migrations;
