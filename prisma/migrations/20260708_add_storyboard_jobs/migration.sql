-- CreateTable
-- 与 chapter_jobs / script_jobs 对齐：无外键（Aliyun RDS approot 无 REFERENCES 权限），
-- 所有权由应用层 assertEpisodeOwner 保证。
CREATE TABLE `storyboard_jobs` (
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
