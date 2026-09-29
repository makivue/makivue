-- SQL approval requires integer primary keys. Keep the existing business keys
-- unique so userId_provider and currency Prisma lookups/upserts remain unchanged.
-- row_id is a database storage sequence; user_id remains a Sonyflake business ID.
ALTER TABLE `user_identities`
    ADD COLUMN `row_id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '存储记录自增序号' FIRST,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (`row_id`),
    ADD UNIQUE INDEX `uk_user_identity_user_provider` (`user_id`, `provider`);

ALTER TABLE `fx_rates`
    ADD COLUMN `row_id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '存储记录自增序号' FIRST,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (`row_id`),
    ADD UNIQUE INDEX `uk_fx_rate_currency` (`currency`);
