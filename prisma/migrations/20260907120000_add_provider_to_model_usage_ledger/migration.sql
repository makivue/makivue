ALTER TABLE `himodels_calls`
    ADD COLUMN `provider` VARCHAR(30) NOT NULL DEFAULT 'himodels' AFTER `generation_id`;
