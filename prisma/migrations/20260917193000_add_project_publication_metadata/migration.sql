ALTER TABLE `projects`
    ADD COLUMN `seo_title` VARCHAR(120) NULL AFTER `total_episodes`,
    ADD COLUMN `seo_description` VARCHAR(500) NULL AFTER `seo_title`,
    ADD COLUMN `seo_keywords` JSON NULL AFTER `seo_description`,
    ADD COLUMN `cover_url` VARCHAR(1024) NULL AFTER `seo_keywords`,
    ADD COLUMN `cover_alt` VARCHAR(255) NULL AFTER `cover_url`,
    ADD COLUMN `trailer_url` VARCHAR(1024) NULL AFTER `cover_alt`,
    ADD COLUMN `trailer_duration` FLOAT NULL AFTER `trailer_url`,
    ADD COLUMN `video_aspect_ratio` VARCHAR(10) NULL AFTER `trailer_duration`,
    ADD COLUMN `visual_style` VARCHAR(100) NULL AFTER `video_aspect_ratio`,
    ADD COLUMN `content_language` VARCHAR(10) NULL AFTER `visual_style`,
    ADD COLUMN `subtitle_languages` JSON NULL AFTER `content_language`,
    ADD COLUMN `episode_format` VARCHAR(20) NULL AFTER `subtitle_languages`,
    ADD COLUMN `visibility` VARCHAR(16) NOT NULL DEFAULT 'private' AFTER `episode_format`,
    ADD COLUMN `published_at` DATETIME(3) NULL AFTER `visibility`;

UPDATE `projects`
SET
    `seo_title` = LEFT(`title`, 120),
    `seo_description` = LEFT(`description`, 500),
    `cover_alt` = LEFT(`title`, 255),
    `video_aspect_ratio` = CASE
        WHEN JSON_VALID(`novel_setup`) AND JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.videoAspectRatio')) IN ('9:16', '16:9', '1:1')
            THEN JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.videoAspectRatio'))
        ELSE '9:16'
    END,
    `visual_style` = CASE
        WHEN JSON_VALID(`novel_setup`) THEN LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.visualStyle')), ''), 100)
        ELSE NULL
    END,
    `content_language` = CASE
        WHEN JSON_VALID(`novel_setup`) AND JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.contentLanguage')) IN ('en', 'zh', 'fr', 'ar', 'id', 'hi', 'fil', 'ja', 'ko')
            THEN JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.contentLanguage'))
        ELSE 'zh'
    END,
    `subtitle_languages` = JSON_ARRAY('zh', 'en', 'fr', 'hi', 'id', 'ar', 'ja', 'ko', 'fil'),
    `episode_format` = CASE
        WHEN JSON_VALID(`novel_setup`) AND JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.episodeFormat')) IN ('micro', 'short', 'long')
            THEN JSON_UNQUOTE(JSON_EXTRACT(`novel_setup`, '$.episodeFormat'))
        ELSE 'micro'
    END;

CREATE INDEX `idx_project_publication` ON `projects` (`visibility`, `published_at`, `id`);
CREATE INDEX `idx_project_owner_visibility` ON `projects` (`user_id`, `visibility`, `id`);
