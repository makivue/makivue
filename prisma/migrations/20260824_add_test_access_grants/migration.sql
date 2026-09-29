-- Test-environment access grants are keyed by the application's signed user
-- ID. The immutable super administrator remains in application configuration
-- and is intentionally not inserted into this table.
CREATE TABLE `test_access_grants` (
    `user_id` BIGINT NOT NULL,
    `created_by_user_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`user_id`),
    INDEX `idx_test_access_grant_created_at` (`created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
