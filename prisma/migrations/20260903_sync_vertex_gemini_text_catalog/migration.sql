UPDATE `ai_service_config`
SET `model_name` = CASE
    WHEN `model_name` = 'gemini:gemini-3.1-flash-lite-preview' THEN 'gemini:gemini-3.1-flash-lite'
    ELSE 'gemini:gemini-3.6-flash'
END
WHERE `provider` IN ('openai', 'chapter_model', 'script_model')
  AND `model_name` IN (
      'gemini:gemini-3.1-pro-preview',
      'gemini:gemini-3.1-flash-lite-preview',
      'gemini:gemini-2.5-pro',
      'gemini:gemini-2.5-flash'
  );
