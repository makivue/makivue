UPDATE `ai_service_config`
SET `model_name` = 'gemini-3.7-flash_trans'
WHERE `provider` IN ('openai', 'chapter_model', 'script_model')
  AND `model_name` IN (
      'gemini-3.1-pro-preview_trans',
      'gemini-3.1-flash-lite-preview_trans',
      'gemini-3.6-flash_trans',
      'gemini-3.5-flash_trans',
      'gemini-2.5-pro_trans',
      'gemini-2.5-flash_trans',
      'claude-opus-4-7_trans',
      'deepseek-v4-flash_trans',
      'deepseek-v4-pro_trans',
      'gpt-5.6-terra_trans',
      'gpt-5.6-sol_trans'
  );
