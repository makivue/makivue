/* FxRate: daily USD-to-currency exchange rates synced from configured providers.
   The special 'fx_rates_last_sync' row tracks daily sync completion (CAS guard). */

CREATE TABLE IF NOT EXISTS `fx_rates` (
    `currency` VARCHAR(32) NOT NULL,
    `rate` DECIMAL(18, 6) NOT NULL,
    `source_date` VARCHAR(10) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`currency`),
    INDEX `idx_fx_rate_date` (`source_date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

/* A previous failed attempt may already have created fx_rates with VARCHAR(10).
   Widen the key before inserting the 18-character sync sentinel. */
ALTER TABLE `fx_rates` MODIFY COLUMN `currency` VARCHAR(32) NOT NULL;

/* Insert the daily-sync sentinel so that tryDailyFxSync can detect last sync date. */
INSERT INTO `fx_rates` (`currency`, `rate`, `source_date`)
VALUES ('fx_rates_last_sync', 0, '')
ON DUPLICATE KEY UPDATE `currency` = VALUES(`currency`);

/* RechargeOrder: add local-currency display, exchange rate and country context.
   All columns are NULLable — existing rows and other providers leave them NULL. */

ALTER TABLE `recharge_orders`
    ADD COLUMN `local_amount_cents` INT NULL AFTER `idempotency_key`,
    ADD COLUMN `local_currency` VARCHAR(3) NULL AFTER `local_amount_cents`,
    ADD COLUMN `country_code` VARCHAR(2) NULL AFTER `local_currency`,
    ADD COLUMN `exchange_rate` DECIMAL(18, 6) NULL AFTER `country_code`;

/* CountryRechargeSku: remove the now-redundant local-cents column. Local amounts
   are computed from amountUsdCents × FxRate at payment time. */

ALTER TABLE `country_recharge_skus` DROP COLUMN `amount_local_cents`;
