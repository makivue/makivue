ALTER TABLE `characters`
  DROP COLUMN `voice_id`,
  DROP COLUMN `voice_name`;

DELETE FROM `ai_service_config`
WHERE `provider` IN ('tts_provider', 'tts', 'elevenlabs', 'azure_tts', 'minimax');
