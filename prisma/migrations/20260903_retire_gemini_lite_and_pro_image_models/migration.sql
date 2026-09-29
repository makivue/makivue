UPDATE `ai_service_config`
SET `model_name` = 'gemini-3.1-flash-image_trans'
WHERE `provider` = 'image'
  AND `model_name` IN (
    'gemini-3.1-flash-lite-image_trans',
    'gemini-3-pro-image_trans'
  );
