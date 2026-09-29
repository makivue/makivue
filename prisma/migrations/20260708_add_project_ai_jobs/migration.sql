-- CreateTable
-- 项目级 AI 任务通用队列表（novel / setup / split_episodes 等）
-- 无外键：与项目里其它 *_jobs 表一致，所有权由应用层 assertProjectOwner 保证。
CREATE TABLE `project_ai_jobs` (
    `id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `phase` VARCHAR(20) NULL DEFAULT 'generating',
    `attempts` INTEGER NULL DEFAULT 0,
    `progress` INTEGER NULL DEFAULT 0,
    `total` INTEGER NULL DEFAULT 0,
    `error` TEXT NULL,
    `result` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_kind`(`kind`),
    INDEX `idx_phase`(`phase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
