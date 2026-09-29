-- Keep a local snapshot of verified third-party identities. The upstream auth
-- service remains the owner of user IDs, so no foreign key is declared here.
CREATE TABLE `user_identities` (
    `user_id` BIGINT NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `provider_subject` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `email_verified` BOOLEAN NOT NULL,
    `display_name` VARCHAR(80) NULL,
    `avatar_url` VARCHAR(1024) NULL,
    `last_login_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `provider`),
    UNIQUE INDEX `uk_user_identity_provider_subject` (`provider`, `provider_subject`),
    INDEX `idx_user_identity_email` (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
