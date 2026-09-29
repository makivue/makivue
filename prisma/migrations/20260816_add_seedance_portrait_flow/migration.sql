-- These tables intentionally omit database-level foreign keys. The deployed
-- Aliyun RDS application account has no REFERENCES privilege; ownership and
-- referential checks are enforced by the authenticated API and transactions.
ALTER TABLE `characters`
    ADD COLUMN `seedance_asset_group_id` VARCHAR(100) NULL,
    ADD COLUMN `seedance_portrait_status` VARCHAR(20) NOT NULL DEFAULT 'unverified';

CREATE TABLE `seedance_portrait_sessions` (
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

    UNIQUE INDEX `uk_seedance_portrait_session_state`(`state`),
    INDEX `idx_seedance_portrait_session_character`(`character_id`, `status`),
    INDEX `idx_seedance_portrait_session_expires`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `seedance_portrait_assets` (
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

    UNIQUE INDEX `uk_seedance_portrait_asset_id`(`asset_id`),
    UNIQUE INDEX `uk_seedance_portrait_source`(`character_id`, `group_id`, `source_url`),
    INDEX `idx_seedance_portrait_asset_character`(`character_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
