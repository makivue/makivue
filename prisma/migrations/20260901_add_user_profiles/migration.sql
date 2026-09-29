-- User identities live in the upstream auth service, so this table deliberately
-- omits a foreign key and stores only application-owned editable profile fields.
CREATE TABLE `user_profiles` (
    `user_id` BIGINT NOT NULL,
    `display_name` VARCHAR(80) NOT NULL,
    `avatar_url` VARCHAR(1024) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
