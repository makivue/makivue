-- Switch existing databases to Prisma-managed relations without physical foreign keys.
-- Legacy deployments may have no foreign keys, or use different constraint names.
-- This upgrade migration is NOT the production empty-database approval SQL.
-- The empty-database DDL already has the final indexes and the DML baselines this migration.
-- Add explicit indexes first so MySQL can retire redundant implicit FK indexes.

SET @relation_index_sql = IF(
    EXISTS(SELECT 1 FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'production_events' AND index_name = 'idx_event_episode'),
    'SELECT 1',
    'CREATE INDEX `idx_event_episode` ON `production_events` (`episode_id`)'
);
PREPARE relation_index_stmt FROM @relation_index_sql;
EXECUTE relation_index_stmt;
DEALLOCATE PREPARE relation_index_stmt;

SET @relation_index_sql = IF(
    EXISTS(SELECT 1 FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'production_events' AND index_name = 'idx_event_storyboard'),
    'SELECT 1',
    'CREATE INDEX `idx_event_storyboard` ON `production_events` (`storyboard_id`)'
);
PREPARE relation_index_stmt FROM @relation_index_sql;
EXECUTE relation_index_stmt;
DEALLOCATE PREPARE relation_index_stmt;

SET @relation_index_sql = IF(
    EXISTS(SELECT 1 FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'quality_reviews' AND index_name = 'idx_review_episode'),
    'SELECT 1',
    'CREATE INDEX `idx_review_episode` ON `quality_reviews` (`episode_id`)'
);
PREPARE relation_index_stmt FROM @relation_index_sql;
EXECUTE relation_index_stmt;
DEALLOCATE PREPARE relation_index_stmt;

SET @relation_index_sql = IF(
    EXISTS(SELECT 1 FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'quality_reviews' AND index_name = 'idx_review_generation'),
    'SELECT 1',
    'CREATE INDEX `idx_review_generation` ON `quality_reviews` (`generation_id`)'
);
PREPARE relation_index_stmt FROM @relation_index_sql;
EXECUTE relation_index_stmt;
DEALLOCATE PREPARE relation_index_stmt;

SET @relation_index_sql = IF(
    EXISTS(SELECT 1 FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'extract_jobs' AND index_name = 'idx_extract_project'),
    'SELECT 1',
    'CREATE INDEX `idx_extract_project` ON `extract_jobs` (`project_id`)'
);
PREPARE relation_index_stmt FROM @relation_index_sql;
EXECUTE relation_index_stmt;
DEALLOCATE PREPARE relation_index_stmt;

-- episodes: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `episodes` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'episodes'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- characters: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `characters` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'characters'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- seedance_portrait_sessions: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `seedance_portrait_sessions` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'seedance_portrait_sessions'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- seedance_portrait_assets: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `seedance_portrait_assets` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'seedance_portrait_assets'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- scenes: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `scenes` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'scenes'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- storyboards: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `storyboards` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'storyboards'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- storyboard_characters: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `storyboard_characters` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'storyboard_characters'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- character_reference_assets: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `character_reference_assets` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'character_reference_assets'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- character_state_events: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `character_state_events` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'character_state_events'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- generations: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `generations` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'generations'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- production_events: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `production_events` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'production_events'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- quality_reviews: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `quality_reviews` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'quality_reviews'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- video_merges: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `video_merges` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'video_merges'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- batch_jobs: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `batch_jobs` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'batch_jobs'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- extract_jobs: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `extract_jobs` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'extract_jobs'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- outline_jobs: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `outline_jobs` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'outline_jobs'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- chapter_jobs: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `chapter_jobs` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'chapter_jobs'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- script_jobs: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `script_jobs` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'script_jobs'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;

-- storyboard_jobs: drop only constraints that actually exist in the selected database.
SET @relation_drop_sql = (
    SELECT IF(COUNT(*) = 0, 'SELECT 1',
        CONCAT('ALTER TABLE `storyboard_jobs` ',
            GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
                         ORDER BY constraint_name SEPARATOR ', ')))
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'storyboard_jobs'
);
PREPARE relation_drop_stmt FROM @relation_drop_sql;
EXECUTE relation_drop_stmt;
DEALLOCATE PREPARE relation_drop_stmt;
