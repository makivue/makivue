SET @subtitle_column_exists = (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'video_merges'
      AND column_name = 'subtitle_urls'
);

SET @subtitle_sql = IF(
    @subtitle_column_exists = 0,
    'ALTER TABLE `video_merges` ADD COLUMN `subtitle_urls` TEXT NULL',
    'SELECT 1'
);

PREPARE subtitle_stmt FROM @subtitle_sql;
EXECUTE subtitle_stmt;
DEALLOCATE PREPARE subtitle_stmt;
