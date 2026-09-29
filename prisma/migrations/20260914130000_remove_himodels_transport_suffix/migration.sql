-- Keep application settings and historical production records aligned with
-- the upstream HiModels identifiers now used by selectors and API requests.
UPDATE `ai_service_config`
SET `model_name` = REPLACE(`model_name`, CONCAT('_', 'trans'), '')
WHERE LOCATE(CONCAT('_', 'trans'), `model_name`) > 0;

UPDATE `generations`
SET
  `provider` = REPLACE(`provider`, CONCAT('_', 'trans'), ''),
  `model_name` = REPLACE(`model_name`, CONCAT('_', 'trans'), ''),
  `error_msg` = REPLACE(`error_msg`, CONCAT('_', 'trans'), ''),
  `request_body` = REPLACE(`request_body`, CONCAT('_', 'trans'), '')
WHERE
  LOCATE(CONCAT('_', 'trans'), `provider`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `model_name`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `error_msg`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `request_body`) > 0;

UPDATE `production_events`
SET
  `provider` = REPLACE(`provider`, CONCAT('_', 'trans'), ''),
  `model_name` = REPLACE(`model_name`, CONCAT('_', 'trans'), ''),
  `metadata` = REPLACE(`metadata`, CONCAT('_', 'trans'), '')
WHERE
  LOCATE(CONCAT('_', 'trans'), `provider`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `model_name`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `metadata`) > 0;

UPDATE `himodels_calls`
SET `model` = REPLACE(`model`, CONCAT('_', 'trans'), '')
WHERE LOCATE(CONCAT('_', 'trans'), `model`) > 0;

UPDATE `character_reference_assets`
SET `provider` = REPLACE(`provider`, CONCAT('_', 'trans'), '')
WHERE LOCATE(CONCAT('_', 'trans'), `provider`) > 0;

UPDATE `creator_assets`
SET `provider` = REPLACE(`provider`, CONCAT('_', 'trans'), '')
WHERE LOCATE(CONCAT('_', 'trans'), `provider`) > 0;

UPDATE `ref_image_jobs`
SET
  `provider` = REPLACE(`provider`, CONCAT('_', 'trans'), ''),
  `error` = REPLACE(`error`, CONCAT('_', 'trans'), ''),
  `result` = REPLACE(`result`, CONCAT('_', 'trans'), '')
WHERE
  LOCATE(CONCAT('_', 'trans'), `provider`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `error`) > 0
  OR LOCATE(CONCAT('_', 'trans'), `result`) > 0;
