# Video original language

The video original language is a global developer setting shared by every project. It controls newly generated spoken dialogue, native-video audio prompts, and subtitle source language.

## Configuration

- Use **Settings → Video original language** as the primary configuration entry.
- Use the compact **中文 / EN** control in the episode storyboard header for quick switching.
- Supported values are `zh` and `en`; the default is `zh`.
- The database value is stored in the existing `ai_service_config` table with `provider = 'video_language'` and `model_name = 'zh' | 'en'`.
- `VIDEO_LANGUAGE=zh|en` is an environment fallback. A database value takes precedence.

No database migration or new column is required.

## Runtime behavior

- The selection applies to future generation and does not silently replace an existing video.
- Dialogue is translated to the selected language before the video provider is called.
- Video prompts include a strict language lock and exact spoken line.
- Subtitle generation treats the selected video language as its source language, then produces the remaining subtitle locales.
- If dialogue translation fails, video generation stops instead of producing speech in the wrong language.
