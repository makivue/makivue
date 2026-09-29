-- Wallet tables intentionally omit database-level foreign keys. The deployed
-- Aliyun RDS application account has no REFERENCES privilege; ownership and
-- consistency checks are enforced by the authenticated API and transactions.
CREATE TABLE `wallet_accounts` (
    `id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `balance_usd` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `lifetime_topup_usd` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `lifetime_spent_usd` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_wallet_user_id` (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wallet_transactions` (
    `id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `amount_usd` DECIMAL(14, 6) NOT NULL,
    `balance_after_usd` DECIMAL(14, 6) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'completed',
    `source_type` VARCHAR(30) NULL,
    `source_id` VARCHAR(100) NULL,
    `idempotency_key` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_wallet_idempotency` (`idempotency_key`),
    INDEX `idx_wallet_tx_user_time` (`user_id`, `created_at`),
    INDEX `idx_wallet_tx_source` (`source_type`, `source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recharge_orders` (
    `id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `amount_usd` DECIMAL(14, 6) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `provider` VARCHAR(30) NOT NULL DEFAULT 'demo',
    `provider_order_id` VARCHAR(120) NULL,
    `idempotency_key` VARCHAR(120) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paid_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uk_recharge_idempotency` (`idempotency_key`),
    INDEX `idx_recharge_user_time` (`user_id`, `created_at`),
    INDEX `idx_recharge_status_time` (`status`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
