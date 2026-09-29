UPDATE `ai_service_config`
SET `model_name` = 'gemini:gemini-3.7-flash'
WHERE `provider` IN ('openai', 'chapter_model', 'script_model')
  AND `model_name` IN (
      'gemini:gemini-3.6-flash',
      'gemini:gemini-3.1-flash-lite',
      'gemini:gemini-3.1-flash-lite-preview'
  );
