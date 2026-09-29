-- idx_generation_kpi starts with type and preserves type-filter index access.
-- Remove the redundant single-column index to meet the 8-index limit (including PK).
ALTER TABLE `generations` DROP INDEX `idx_type`;

-- Preserve provider uniqueness while adopting the required unique-index prefix.
ALTER TABLE `ai_service_config`
    RENAME INDEX `provider` TO `uk_ai_service_config_provider`;

-- Storage-only sequences must be named id and use UNSIGNED.
-- Prisma retains rowId as its mapped field; user_id remains a Sonyflake business ID.
ALTER TABLE `user_identities`
    CHANGE COLUMN `row_id` `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '存储记录自增序号';

ALTER TABLE `fx_rates`
    CHANGE COLUMN `row_id` `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '存储记录自增序号';
