UPDATE `ai_service_config`
SET `model_name` = 'gemini-3.1-flash-image_trans'
WHERE `provider` = 'image'
  AND `model_name` = 'gpt-image-2';
