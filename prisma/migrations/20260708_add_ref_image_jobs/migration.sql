-- CreateTable
-- 角色 / 场景参考图生成异步 job（同表用 target_type 区分）
-- 无外键：与项目里其它 *_jobs 表一致，所有权由应用层 assertCharacterOwner / assertSceneOwner 保证。
CREATE TABLE `ref_image_jobs` (
    `id` BIGINT NOT NULL,
    `target_type` VARCHAR(20) NOT NULL,
    `target_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `phase` VARCHAR(20) NULL DEFAULT 'generating',
    `attempts` INTEGER NULL DEFAULT 0,
    `error` TEXT NULL,
    `result` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX `idx_target`(`target_type`, `target_id`),
    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_phase`(`phase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
