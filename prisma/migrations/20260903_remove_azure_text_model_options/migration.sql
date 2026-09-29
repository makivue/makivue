UPDATE `ai_service_config`
SET `model_name` = 'gemini:gemini-3.6-flash'
WHERE `provider` IN ('openai', 'chapter_model', 'script_model')
  AND `model_name` IN (
      'gpt-5.4-shortdrama',
      'gpt-5.5-shortdrama'
  );
