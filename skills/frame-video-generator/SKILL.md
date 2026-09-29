# Frame And Video Generator

## Purpose

Generate first, middle, and last frames for each storyboard, then generate stable image-to-video shots.

## When To Use

- Generating illustration frames.
- Generating image-to-video.
- Debugging bad frame quality, repeated images, or video drift.

## Inputs

- Storyboard action and image prompt.
- Character references.
- Scene references.
- Style references.
- First frame URL and last frame URL.
- Provider-specific URL requirements.

## Rules

1. Generate first and last frames for every storyboard.
2. Generate middle frames when a shot needs bridge visuals.
3. Public URL is mandatory for providers that cannot fetch local files.
4. Use unique generation filenames to avoid cache collisions.
5. Video prompts should describe one stable continuous motion.
6. Avoid fast action, large position changes, camera cuts, text, subtitles, logos, extra limbs, and identity drift.
7. Retry rate-limited video calls with backoff.

## Project Hooks

- `src/services/ai.ts`: `generateFrame`, `generateVideo`
- `src/services/storyboard-generation-handler.ts`
- `src/app/api/episodes/[id]/generate-all/route.ts`
- `src/services/banana.ts`
- `src/services/oss.ts`

## References

- Image-to-video workflows using first/last frame constraints.
