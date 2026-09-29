-- A USD 1,000 tier exceeds signed INT cents in currencies such as VND.
ALTER TABLE `recharge_orders` MODIFY COLUMN `local_amount_cents` BIGINT NULL;
