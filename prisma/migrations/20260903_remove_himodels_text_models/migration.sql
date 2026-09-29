UPDATE `ai_service_config`
SET `model_name` = CASE
    WHEN `model_name` = 'gemini-3.1-pro-preview_trans' THEN 'gemini-3.7-flash_trans'
    WHEN `model_name` = 'gemini-3.5-flash_trans' THEN 'gemini-3.6-flash_trans'
    WHEN `model_name` = 'deepseek-v4-flash_trans' THEN 'deepseek-v4-pro_trans'
    ELSE 'gpt-5.6-sol_trans'
END
WHERE `provider` IN ('openai', 'chapter_model', 'script_model')
  AND `model_name` IN (
      'gemini-3.1-pro-preview_trans',
      'gemini-3.5-flash_trans',
      'claude-opus-4-7_trans',
      'deepseek-v4-flash_trans',
      'gpt-5.6-terra_trans'
  );
