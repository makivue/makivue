-- Wallet balances and wallet transactions are denominated exclusively in
-- points. Recharge orders retain USD solely as the payment-provider settlement
-- amount. Existing wallet values are converted at $1 = 100 points.
ALTER TABLE `wallet_accounts`
    CHANGE COLUMN `balance_usd` `balance_points` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    CHANGE COLUMN `lifetime_topup_usd` `lifetime_topup_points` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    CHANGE COLUMN `lifetime_spent_usd` `lifetime_spent_points` DECIMAL(18, 4) NOT NULL DEFAULT 0;

UPDATE `wallet_accounts`
SET `balance_points` = ROUND(`balance_points` * 100, 4),
    `lifetime_topup_points` = ROUND(`lifetime_topup_points` * 100, 4),
    `lifetime_spent_points` = ROUND(`lifetime_spent_points` * 100, 4);

ALTER TABLE `wallet_transactions`
    CHANGE COLUMN `amount_usd` `amount_points` DECIMAL(18, 4) NOT NULL,
    CHANGE COLUMN `balance_after_usd` `balance_after_points` DECIMAL(18, 4) NOT NULL;

UPDATE `wallet_transactions`
SET `amount_points` = ROUND(`amount_points` * 100, 4),
    `balance_after_points` = ROUND(`balance_after_points` * 100, 4);

-- A recharge order records the external payment amount, not wallet balance.
ALTER TABLE `recharge_orders`
    CHANGE COLUMN `amount_usd` `payment_amount_usd` DECIMAL(14, 6) NOT NULL;
