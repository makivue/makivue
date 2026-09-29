ALTER TABLE `himodels_calls` ADD COLUMN `billing` JSON NULL;

CREATE TABLE `wallet_reservations` (
    `id` BIGINT NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `scope_key` VARCHAR(100) NOT NULL,
    `amount_points` DECIMAL(18,4) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'reserved',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `uk_wallet_reservation_key` (`key`),
    INDEX `idx_wallet_reservation_scope` (`user_id`, `scope_key`, `status`),
    INDEX `idx_wallet_reservation_recovery` (`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
