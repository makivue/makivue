-- CreateTable
CREATE TABLE `provider_quotas` (
    `key` CHAR(64) NOT NULL,
    `next_start_at_ms` BIGINT NOT NULL DEFAULT 0,
    `window_start_ms` BIGINT NOT NULL DEFAULT 0,
    `token_budget` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_quota_leases` (
    `id` BIGINT NOT NULL,
    `scope_key` CHAR(64) NOT NULL,
    `expires_at_ms` BIGINT NOT NULL,

    INDEX `idx_provider_quota_active`(`scope_key`, `expires_at_ms`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
