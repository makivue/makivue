ALTER TABLE `projects`
    MODIFY COLUMN `novel_setup` LONGTEXT NULL,
    ADD COLUMN `genre_code` VARCHAR(50) NULL,
    ADD COLUMN `genre_label` VARCHAR(100) NULL,
    ADD COLUMN `source_answers` JSON NULL,
    ADD COLUMN `direction_candidates` JSON NULL,
    ADD COLUMN `selected_direction_id` VARCHAR(100) NULL,
    ADD COLUMN `content_facts` JSON NULL,
    ADD COLUMN `stale_scopes` JSON NULL,
    ADD COLUMN `source_version` INT NOT NULL DEFAULT 1;

UPDATE `projects`
SET `genre_code` = CASE
        WHEN `genre` IN ('都市', '现代') THEN 'modern'
        WHEN `genre` = '言情' THEN 'romance'
        WHEN `genre` IN ('悬疑', '推理') THEN 'suspense'
        WHEN `genre` = '喜剧' THEN 'comedy'
        WHEN `genre` = '动作' THEN 'action'
        WHEN `genre` IN ('古装', '历史') THEN 'historical'
        WHEN `genre` = '科幻' THEN 'sci_fi'
        WHEN `genre` = '奇幻' THEN 'fantasy'
        WHEN `genre` = '校园' THEN 'campus'
        WHEN `genre` = '权谋' THEN 'political'
        ELSE 'other'
    END,
    `genre_label` = COALESCE(NULLIF(TRIM(`genre`), ''), '其他')
WHERE `genre_code` IS NULL;

ALTER TABLE `episodes`
    ADD COLUMN `source_version` INT NOT NULL DEFAULT 1,
    ADD COLUMN `content_facts` JSON NULL,
    ADD COLUMN `state_snapshot` JSON NULL,
    ADD COLUMN `stale_reason` VARCHAR(255) NULL;

ALTER TABLE `characters`
    ADD COLUMN `canonical_name` VARCHAR(100) NULL,
    ADD COLUMN `aliases` JSON NULL,
    ADD COLUMN `source_type` VARCHAR(30) NULL,
    ADD COLUMN `source_version` INT NOT NULL DEFAULT 1,
    ADD COLUMN `confirmation_status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    ADD COLUMN `reference_assets` JSON NULL,
    ADD COLUMN `state_timeline` JSON NULL,
    ADD COLUMN `operation_version` INT NOT NULL DEFAULT 0;

UPDATE `characters` c
JOIN (
    SELECT `project_id`, LOWER(TRIM(`name`)) AS normalized_name, MIN(`id`) AS keeper_id
    FROM `characters`
    GROUP BY `project_id`, LOWER(TRIM(`name`))
) d ON d.`project_id` = c.`project_id` AND d.`normalized_name` = LOWER(TRIM(c.`name`))
SET c.`canonical_name` = IF(c.`id` = d.`keeper_id`, d.`normalized_name`, CONCAT(LEFT(d.`normalized_name`, 75), '#', c.`id`)),
    c.`aliases` = JSON_ARRAY(c.`name`),
    c.`source_type` = COALESCE(c.`source_type`, 'legacy'),
    c.`reference_assets` = CASE
        WHEN c.`reference_image_url` IS NULL THEN JSON_ARRAY()
        ELSE JSON_ARRAY(JSON_OBJECT('role', 'full_body', 'url', c.`reference_image_url`, 'status', 'selected', 'sourceVersion', 1))
    END;

ALTER TABLE `characters`
    ADD UNIQUE INDEX `uk_character_project_canonical` (`project_id`, `canonical_name`);

ALTER TABLE `scenes`
    ADD COLUMN `canonical_name` VARCHAR(100) NULL,
    ADD COLUMN `aliases` JSON NULL,
    ADD COLUMN `source_type` VARCHAR(30) NULL,
    ADD COLUMN `source_version` INT NOT NULL DEFAULT 1,
    ADD COLUMN `confirmation_status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    ADD COLUMN `reference_assets` JSON NULL,
    ADD COLUMN `operation_version` INT NOT NULL DEFAULT 0;

UPDATE `scenes` s
JOIN (
    SELECT `project_id`, LOWER(TRIM(`name`)) AS normalized_name, MIN(`id`) AS keeper_id
    FROM `scenes`
    GROUP BY `project_id`, LOWER(TRIM(`name`))
) d ON d.`project_id` = s.`project_id` AND d.`normalized_name` = LOWER(TRIM(s.`name`))
SET s.`canonical_name` = IF(s.`id` = d.`keeper_id`, d.`normalized_name`, CONCAT(LEFT(d.`normalized_name`, 75), '#', s.`id`)),
    s.`aliases` = JSON_ARRAY(s.`name`),
    s.`source_type` = COALESCE(s.`source_type`, 'legacy'),
    s.`reference_assets` = CASE
        WHEN s.`reference_image_url` IS NULL THEN JSON_ARRAY()
        ELSE JSON_ARRAY(JSON_OBJECT('role', 'environment', 'url', s.`reference_image_url`, 'status', 'selected', 'sourceVersion', 1))
    END;

ALTER TABLE `scenes`
    ADD UNIQUE INDEX `uk_scene_project_canonical` (`project_id`, `canonical_name`);

ALTER TABLE `storyboards`
    ADD COLUMN `planned_last_frame_url` VARCHAR(512) NULL,
    ADD COLUMN `actual_video_end_frame_url` VARCHAR(512) NULL,
    ADD COLUMN `motion_override` TEXT NULL,
    ADD COLUMN `full_prompt_override` TEXT NULL,
    ADD COLUMN `expected_audio_mode` VARCHAR(30) NULL,
    ADD COLUMN `composition_mode` VARCHAR(30) NULL,
    ADD COLUMN `generation_stage` VARCHAR(30) NULL,
    ADD COLUMN `polish_status` VARCHAR(20) NULL,
    ADD COLUMN `prompt_version` VARCHAR(100) NULL,
    ADD COLUMN `generation_model` VARCHAR(100) NULL,
    ADD COLUMN `original_shot_type` VARCHAR(50) NULL,
    ADD COLUMN `original_camera_movement` VARCHAR(50) NULL,
    ADD COLUMN `normalization_metadata` JSON NULL,
    ADD COLUMN `source_version` INT NOT NULL DEFAULT 1,
    ADD COLUMN `stale_reason` VARCHAR(255) NULL;

UPDATE `storyboards`
SET `planned_last_frame_url` = `last_frame_url`,
    `motion_override` = `video_prompt`,
    `generation_stage` = 'legacy',
    `polish_status` = 'unknown',
    `original_shot_type` = `shot_type`,
    `original_camera_movement` = `camera_movement`
WHERE `planned_last_frame_url` IS NULL;

ALTER TABLE `generations`
    ADD COLUMN `input_assets` JSON NULL,
    ADD COLUMN `prompt_version` VARCHAR(100) NULL,
    ADD COLUMN `planned_duration` DOUBLE NULL,
    ADD COLUMN `actual_duration` DOUBLE NULL,
    ADD COLUMN `composition_mode` VARCHAR(30) NULL;

ALTER TABLE `video_merges`
    ADD COLUMN `video_status` VARCHAR(20) NULL DEFAULT 'pending',
    ADD COLUMN `subtitle_status` VARCHAR(20) NULL DEFAULT 'pending',
    ADD COLUMN `subtitle_progress` JSON NULL,
    ADD COLUMN `target_width` INT NULL,
    ADD COLUMN `target_height` INT NULL;

UPDATE `video_merges`
SET `video_status` = CASE WHEN `status` = 'completed' THEN 'completed' WHEN `status` = 'failed' THEN 'failed' ELSE 'pending' END,
    `subtitle_status` = CASE WHEN `subtitle_urls` IS NOT NULL AND `subtitle_urls` <> '' THEN 'completed' ELSE 'pending' END;

-- Keep the new lineage tables without database-level foreign keys. The
-- deployed Aliyun RDS application account has no REFERENCES privilege;
-- ownership and referential checks are enforced by the API, matching the
-- existing *_jobs and production-observability tables.
CREATE TABLE `character_reference_assets` (
    `id` BIGINT NOT NULL,
    `character_id` BIGINT NOT NULL,
    `role` VARCHAR(30) NOT NULL,
    `state_key` VARCHAR(100) NULL,
    `url` VARCHAR(512) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'candidate',
    `provider` VARCHAR(50) NULL,
    `prompt_version` VARCHAR(100) NULL,
    `source_version` INT NOT NULL DEFAULT 1,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `idx_character_asset_role` (`character_id`, `role`, `status`),
    INDEX `idx_character_asset_state` (`character_id`, `state_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `character_reference_assets` (`id`, `character_id`, `role`, `url`, `status`, `source_version`, `created_at`, `updated_at`)
SELECT `id`, `id`, 'full_body', `reference_image_url`, 'selected', 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `characters`
WHERE `reference_image_url` IS NOT NULL;

CREATE TABLE `character_state_events` (
    `id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `character_id` BIGINT NOT NULL,
    `episode_number` INT NOT NULL,
    `storyboard_id` BIGINT NULL,
    `sequence` INT NOT NULL DEFAULT 0,
    `state_key` VARCHAR(100) NOT NULL,
    `state` JSON NOT NULL,
    `source_type` VARCHAR(30) NOT NULL,
    `source_version` INT NOT NULL DEFAULT 1,
    `effective_until_episode` INT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_character_state_event` (`character_id`, `episode_number`, `storyboard_id`, `sequence`, `state_key`),
    INDEX `idx_character_state_project_episode` (`project_id`, `episode_number`),
    INDEX `idx_character_state_timeline` (`character_id`, `episode_number`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `extract_jobs`
    ADD COLUMN `committed_at` DATETIME(3) NULL,
    ADD COLUMN `committed_selection` JSON NULL,
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_extract_job_active_key` (`active_key`);

ALTER TABLE `outline_jobs`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_outline_job_active_key` (`active_key`);

ALTER TABLE `chapter_jobs`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_chapter_job_active_key` (`active_key`);

ALTER TABLE `script_jobs`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_script_job_active_key` (`active_key`);

ALTER TABLE `storyboard_jobs`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_storyboard_job_active_key` (`active_key`);

ALTER TABLE `project_ai_jobs`
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_project_ai_job_active_key` (`active_key`);

ALTER TABLE `ref_image_jobs`
    ADD COLUMN `prompt_version` VARCHAR(100) NULL,
    ADD COLUMN `provider` VARCHAR(50) NULL,
    ADD COLUMN `quality` VARCHAR(20) NULL,
    ADD COLUMN `active_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(100) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `uk_ref_image_job_active_key` (`active_key`);
