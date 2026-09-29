# Entity Bible Extractor

## Purpose

Extract and merge the project character bible and scene bible from all generated scripts.

## When To Use

- After scripts are generated.
- Before reference images.
- Before storyboard generation.
- When character or scene consistency is weak.

## Inputs

- All episode scripts.
- Existing characters and scenes.
- Known character names and scene names.

## Rules

1. Extract in chunks for stability.
2. Merge duplicate character versions into one canonical character card.
3. Do not keep generic entities like "passerby" or "servant" unless they become a named recurring role.
4. Character cards must include appearance prompts suitable for image generation.
5. Scene cards must include fixed spatial layout, entrances/exits, major props, lighting, and time-of-day notes.
6. Important props that connect shots should be written into character or scene descriptions.

## Output Contract

- `characters`: canonical named characters with role, personality, and appearance prompt.
- `scenes`: canonical scenes with description and location prompt.
- `frequency`: occurrence count for prioritization.

## Project Hooks

- `src/services/llm.ts`: `extractCharactersAndScenesBatched`
- `src/app/api/ai/extract/route.ts`
- `src/app/api/ai/extract/preview/route.ts`
- `src/app/api/ai/extract/commit/route.ts`

## References

- Character design sheet and scene bible workflows.
