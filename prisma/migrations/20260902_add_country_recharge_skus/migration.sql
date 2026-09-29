/* CountryRechargeSku: per-country recharge tier pricing. Each row defines the
   USD price (in cents) and points awarded. Local-currency amounts are computed
   from FxRate at display/payment time. */

CREATE TABLE IF NOT EXISTS `country_recharge_skus` (
    `id` BIGINT NOT NULL,
    `country_code` VARCHAR(2) NOT NULL,
    `sku_code` VARCHAR(50) NOT NULL,
    `amount_usd_cents` INT NOT NULL,
    `points` INT NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `label` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_sku_code` (`sku_code`),
    INDEX `idx_sku_country_enabled` (`country_code`, `enabled`),
    INDEX `idx_sku_sort` (`sort_order`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
