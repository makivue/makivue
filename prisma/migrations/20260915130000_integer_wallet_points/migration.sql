-- Wallet coins are indivisible. Historical debits round away from zero so the
-- platform never undercharges; spendable balances round down. Existing write
-- paths already emit integers, and each update/alter takes its normal DB lock.

CREATE TEMPORARY TABLE `_wallet_transaction_integerized` (
    `id` BIGINT NOT NULL PRIMARY KEY,
    `user_id` BIGINT NOT NULL,
    `applied_delta` DECIMAL(22,4) NOT NULL,
    `spent_delta` DECIMAL(22,4) NOT NULL,
    `topup_delta` DECIMAL(22,4) NOT NULL,
    `new_amount_points` DECIMAL(18,0) NOT NULL,
    `new_balance_after_points` DECIMAL(18,0) NOT NULL
);

INSERT INTO `_wallet_transaction_integerized` (
    `id`,
    `user_id`,
    `applied_delta`,
    `spent_delta`,
    `topup_delta`,
    `new_amount_points`,
    `new_balance_after_points`
)
SELECT
    rounded.`id`,
    rounded.`user_id`,
    IF(rounded.`status` = 'completed', rounded.`new_amount_points` - rounded.`old_amount_points`, 0),
    IF(rounded.`status` = 'completed' AND rounded.`type` = 'usage', ABS(rounded.`new_amount_points`) - ABS(rounded.`old_amount_points`), 0),
    IF(rounded.`status` = 'completed' AND rounded.`type` = 'recharge', rounded.`new_amount_points` - rounded.`old_amount_points`, 0),
    rounded.`new_amount_points`,
    FLOOR(
        rounded.`old_balance_after_points`
        + SUM(IF(rounded.`status` = 'completed', rounded.`new_amount_points` - rounded.`old_amount_points`, 0)) OVER (
            PARTITION BY rounded.`user_id`
            ORDER BY rounded.`created_at`, rounded.`id`
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
    )
FROM (
    SELECT
        `id`,
        `user_id`,
        `type`,
        `status`,
        `created_at`,
        `amount_points` AS `old_amount_points`,
        `balance_after_points` AS `old_balance_after_points`,
        CASE
            WHEN `amount_points` < 0 THEN FLOOR(`amount_points`)
            ELSE CEIL(`amount_points`)
        END AS `new_amount_points`
    FROM `wallet_transactions`
) AS rounded;

CREATE TEMPORARY TABLE `_wallet_account_transaction_deltas` AS
SELECT
    `user_id`,
    SUM(`applied_delta`) AS `applied_delta`,
    SUM(`spent_delta`) AS `spent_delta`,
    SUM(`topup_delta`) AS `topup_delta`
FROM `_wallet_transaction_integerized`
GROUP BY `user_id`;

CREATE TEMPORARY TABLE `_wallet_reservation_integerized` AS
SELECT
    `id`,
    `user_id`,
    `status`,
    `amount_points` AS `old_amount_points`,
    CEIL(`amount_points`) AS `new_amount_points`
FROM `wallet_reservations`;

CREATE TEMPORARY TABLE `_wallet_account_reservation_deltas` AS
SELECT
    `user_id`,
    SUM(IF(`status` = 'reserved', `new_amount_points` - `old_amount_points`, 0)) AS `active_delta`
FROM `_wallet_reservation_integerized`
GROUP BY `user_id`;

UPDATE `wallet_accounts` AS account
LEFT JOIN `_wallet_account_transaction_deltas` AS transaction_delta ON transaction_delta.`user_id` = account.`user_id`
LEFT JOIN `_wallet_account_reservation_deltas` AS reservation_delta ON reservation_delta.`user_id` = account.`user_id`
SET
    account.`balance_points` = FLOOR(account.`balance_points` + COALESCE(transaction_delta.`applied_delta`, 0) - COALESCE(reservation_delta.`active_delta`, 0)),
    account.`lifetime_topup_points` = CEIL(account.`lifetime_topup_points` + COALESCE(transaction_delta.`topup_delta`, 0)),
    account.`lifetime_spent_points` = CEIL(account.`lifetime_spent_points` + COALESCE(transaction_delta.`spent_delta`, 0));

UPDATE `wallet_transactions` AS transaction
INNER JOIN `_wallet_transaction_integerized` AS rounded ON rounded.`id` = transaction.`id`
SET
    transaction.`amount_points` = rounded.`new_amount_points`,
    transaction.`balance_after_points` = rounded.`new_balance_after_points`;

UPDATE `wallet_reservations` AS reservation
INNER JOIN `_wallet_reservation_integerized` AS rounded ON rounded.`id` = reservation.`id`
SET reservation.`amount_points` = rounded.`new_amount_points`;

ALTER TABLE `wallet_accounts`
    MODIFY COLUMN `balance_points` DECIMAL(18,0) NOT NULL DEFAULT 0,
    MODIFY COLUMN `lifetime_topup_points` DECIMAL(18,0) NOT NULL DEFAULT 0,
    MODIFY COLUMN `lifetime_spent_points` DECIMAL(18,0) NOT NULL DEFAULT 0;

ALTER TABLE `wallet_transactions`
    MODIFY COLUMN `amount_points` DECIMAL(18,0) NOT NULL,
    MODIFY COLUMN `balance_after_points` DECIMAL(18,0) NOT NULL;

ALTER TABLE `wallet_reservations`
    MODIFY COLUMN `amount_points` DECIMAL(18,0) NOT NULL;

DROP TEMPORARY TABLE `_wallet_account_reservation_deltas`;
DROP TEMPORARY TABLE `_wallet_reservation_integerized`;
DROP TEMPORARY TABLE `_wallet_account_transaction_deltas`;
DROP TEMPORARY TABLE `_wallet_transaction_integerized`;
