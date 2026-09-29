ALTER TABLE `storyboards`
    ADD COLUMN `continuity_state` JSON NULL,
    ADD COLUMN `continuity_state_version` INT NOT NULL DEFAULT 1;
