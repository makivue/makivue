# Reference Image Director

## Purpose

Generate consistent style, character, and scene reference images for downstream frame and video generation.

## When To Use

- Generating project style reference images.
- Generating character reference images.
- Generating scene reference images.
- Diagnosing inconsistent faces, clothes, or locations.

## Inputs

- Visual style preset.
- Style preview thumbnail for user selection.
- Character appearance prompt.
- Scene location prompt.
- Existing style reference images.

## Rules

1. Reference images are identity anchors, not one-off illustrations.
2. Style preset thumbnails are UX previews only; model consistency must come from the preset prompt and generated style/character/scene reference images.
3. Character reference must show face, hair, outfit, body shape, age, and style clearly.
4. Scene reference must show layout, entrances/exits, light direction, signature props, and mood.
5. All reference outputs must be uploaded to local storage or otherwise available as public URLs for video providers.
6. If reference image generation fails, retry; if still missing, allow warning but mark consistency risk.

## Project Hooks

- `src/app/api/projects/[id]/style-reference/route.ts`
- `src/app/api/characters/[id]/reference/route.ts`
- `src/app/api/scenes/[id]/reference/route.ts`
- `src/services/ai.ts`
- `src/services/oss.ts`

## References

- Fooocus/SDXL-style preset systems: group style choices into readable presets, then translate them into prompt prefixes rather than exposing raw model jargon to users.
- Character consistency and design-sheet workflows.
