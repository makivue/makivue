-- CreateTable
CREATE TABLE `ep_jobs` (
    `id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `episode_id` BIGINT NOT NULL,
    `phase` VARCHAR(20) NULL DEFAULT 'running',
    `total` INTEGER NULL DEFAULT 0,
    `shots` JSON NULL,
    `error_msg` TEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`),
    INDEX `idx_episode_id` (`episode_id`),
    INDEX `idx_project_id` (`project_id`),
    INDEX `idx_phase` (`phase`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
