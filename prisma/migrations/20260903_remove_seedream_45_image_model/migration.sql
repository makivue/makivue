UPDATE `ai_service_config`
SET `model_name` = 'seedream-5-0-lite_trans'
WHERE `provider` = 'image'
  AND `model_name` = 'seedream-4-5_trans';
