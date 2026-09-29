ALTER TABLE `storyboards`
    ADD COLUMN `continuity_mode` VARCHAR(20) NOT NULL DEFAULT 'independent',
    ADD COLUMN `continuity_group` INT NULL,
    ADD COLUMN `continuity_reason` VARCHAR(255) NULL,
    ADD INDEX `idx_continuity_group` (`episode_id`, `continuity_group`);
