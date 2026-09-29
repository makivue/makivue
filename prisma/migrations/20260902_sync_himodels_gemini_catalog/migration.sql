UPDATE `ai_service_config`
SET `model_name` = CASE
    WHEN `model_name` = 'gemini-2.5-pro_trans' THEN 'gemini-3.1-pro-preview_trans'
    ELSE 'gemini-3.5-flash_trans'
END
WHERE `provider` IN ('openai', 'chapter_model', 'script_model')
  AND `model_name` IN (
      'gemini-3.1-flash-lite-preview_trans',
      'gemini-2.5-pro_trans',
      'gemini-2.5-flash_trans'
  );
