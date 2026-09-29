-- The payment flow stores callback and provider identifiers on recharge orders.
-- Keep this migration idempotent because the test database may have been
SET @add_recharge_order_metadata = IF(
    EXISTS(
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'recharge_orders'
          AND column_name = 'metadata'
    ),
    'SELECT 1',
    'ALTER TABLE `recharge_orders` ADD COLUMN `metadata` JSON NULL AFTER `idempotency_key`'
);

PREPARE add_recharge_order_metadata_stmt FROM @add_recharge_order_metadata;
EXECUTE add_recharge_order_metadata_stmt;
DEALLOCATE PREPARE add_recharge_order_metadata_stmt;
