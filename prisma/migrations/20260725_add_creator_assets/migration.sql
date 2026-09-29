-- Creator assets intentionally omit database-level foreign keys. Ownership is
-- enforced by authenticated APIs, matching the existing wallet tables.
CREATE TABLE IF NOT EXISTS `creator_assets` (
    `id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `url` VARCHAR(1024) NOT NULL,
    `cover_url` VARCHAR(1024) NULL,
    `prompt` TEXT NULL,
    `provider` VARCHAR(50) NULL,
    `ratio` VARCHAR(20) NULL,
    `duration` INT NULL,
    `source_job_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_creator_asset_source_job` (`source_job_id`),
    INDEX `idx_creator_asset_user_id` (`user_id`, `id`),
    INDEX `idx_creator_asset_user_type` (`user_id`, `type`, `id`),
    INDEX `idx_creator_asset_deleted_at` (`deleted_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
