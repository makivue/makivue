-- CreateTable
-- No foreign key on project_id/episode_id — some environments (e.g. Aliyun RDS
-- approot) lack REFERENCES privilege. Ownership is enforced in application
-- code via assertEpisodeOwner.
CREATE TABLE `chapter_jobs` (
    `id` BIGINT NOT NULL,
    `episode_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `phase` VARCHAR(20) NULL DEFAULT 'generating',
    `attempts` INTEGER NULL DEFAULT 0,
    `error` TEXT NULL,
    `result` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX `idx_episode_id`(`episode_id`),
    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_phase`(`phase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
