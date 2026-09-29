ALTER TABLE `generations`
    ADD COLUMN `model_name` VARCHAR(100) NULL,
    ADD COLUMN `error_code` VARCHAR(50) NULL,
    ADD COLUMN `retry_index` INT NOT NULL DEFAULT 0,
    ADD COLUMN `duration_ms` INT NULL,
    ADD COLUMN `estimated_cost_usd` DECIMAL(12, 6) NULL,
    ADD COLUMN `metrics` JSON NULL,
    ADD COLUMN `started_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `completed_at` DATETIME(3) NULL,
    ADD INDEX `idx_created_at` (`created_at`),
    ADD INDEX `idx_generation_kpi` (`type`, `provider`, `status`);

-- Keep these tables without database-level foreign keys. The deployed Aliyun
-- RDS application account does not have REFERENCES privilege; ownership and
-- referential checks follow the existing *_jobs tables and live in the API.
CREATE TABLE `production_events` (
    `id` BIGINT NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `project_id` BIGINT NOT NULL,
    `episode_id` BIGINT NULL,
    `storyboard_id` BIGINT NULL,
    `generation_id` BIGINT NULL,
    `event_type` VARCHAR(50) NOT NULL,
    `stage` VARCHAR(30) NOT NULL,
    `provider` VARCHAR(50) NULL,
    `model_name` VARCHAR(100) NULL,
    `status` VARCHAR(20) NOT NULL,
    `duration_ms` INT NULL,
    `cost_usd` DECIMAL(12, 6) NULL,
    `error_code` VARCHAR(50) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_event_key` (`event_key`),
    INDEX `idx_event_project_time` (`project_id`, `created_at`),
    INDEX `idx_event_kpi` (`stage`, `provider`, `status`),
    INDEX `idx_event_generation` (`generation_id`),
    UNIQUE INDEX `uk_event_generation_type` (`generation_id`, `event_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `quality_reviews` (
    `id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `episode_id` BIGINT NULL,
    `storyboard_id` BIGINT NULL,
    `generation_id` BIGINT NULL,
    `scope` VARCHAR(30) NOT NULL,
    `reviewer` VARCHAR(50) NOT NULL DEFAULT 'rules-v1',
    `status` VARCHAR(20) NOT NULL,
    `score` DOUBLE NOT NULL,
    `issue_count` INT NOT NULL DEFAULT 0,
    `blocker_count` INT NOT NULL DEFAULT 0,
    `issues` JSON NOT NULL,
    `redo_plan` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `idx_review_project_time` (`project_id`, `created_at`),
    INDEX `idx_review_storyboard_time` (`storyboard_id`, `created_at`),
    INDEX `idx_review_quality` (`status`, `score`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
