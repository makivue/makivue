ALTER TABLE `projects`
    ADD COLUMN `operation_version` INT NOT NULL DEFAULT 0;

ALTER TABLE `episodes`
    ADD COLUMN `operation_version` INT NOT NULL DEFAULT 0;

ALTER TABLE `storyboards`
    ADD COLUMN `operation_version` INT NOT NULL DEFAULT 0;

ALTER TABLE `generations`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `resource_version` INT NOT NULL DEFAULT 0,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD INDEX `idx_generation_worker_claim` (`status`, `next_attempt_at`, `lease_expires_at`),
    ADD UNIQUE INDEX `uk_generation_active_key` (`active_key`);

ALTER TABLE `video_merges`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `resource_version` INT NOT NULL DEFAULT 0,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `attempts` INT NOT NULL DEFAULT 0,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD INDEX `idx_video_merge_worker_claim` (`status`, `next_attempt_at`, `lease_expires_at`),
    ADD UNIQUE INDEX `uk_video_merge_active_key` (`active_key`);

CREATE TABLE `admin_grants` (
    `id` BIGINT NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` VARCHAR(30) NOT NULL DEFAULT 'viewer',
    `permissions` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by_email` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_admin_grant_email` (`email`),
    INDEX `idx_admin_grant_enabled_role` (`enabled`, `role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
