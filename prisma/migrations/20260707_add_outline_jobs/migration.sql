-- CreateTable
-- Note: no foreign key on project_id — the DB user lacks REFERENCES privilege
-- in some environments (e.g. Aliyun RDS approot). Ownership is enforced in
-- application code via assertProjectOwner.
CREATE TABLE `outline_jobs` (
    `id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `phase` VARCHAR(20) NULL DEFAULT 'generating',
    `total_episodes` INTEGER NULL DEFAULT 0,
    `received_chapters` INTEGER NULL DEFAULT 0,
    `error` TEXT NULL,
    `result` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_phase`(`phase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
