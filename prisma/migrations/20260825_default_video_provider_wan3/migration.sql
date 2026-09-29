-- Move the existing product-wide default from Seedance 2.5 to Wan 3.0.
-- Explicit selections made after this migration remain untouched.
UPDATE `ai_service_config`
SET `model_name` = 'wan3'
WHERE `provider` = 'video'
  AND (`model_name` IS NULL OR `model_name` = 'seedance25');
