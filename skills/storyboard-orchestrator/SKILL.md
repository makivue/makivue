# Storyboard Orchestrator

## Purpose

Convert scripts into stable, high-quality, image/video-ready storyboards.

## When To Use

- Generating storyboards.
- Regenerating weak storyboards.
- Fixing poor image prompts or broken shot continuity.

## Inputs

- Current episode script.
- Story bible and episode state plan.
- Character whitelist and scene whitelist.
- Full previous visual ledger.
- Previous episode ending anchor.

## Rules

1. Every shot must have `Opening state: ...; Ending state: ...`.
2. Every shot should contain one simple continuous action or one emotional change.
3. Character names and scene names must come from whitelists.
4. `imagePrompt` must be a production-ready English prompt.
5. Later shots must inherit prior shot states: identity, outfit, props, light, weather, and spatial relation.
6. If a scene/time jump is too abrupt, insert a bridge shot.
7. Do not assign one fixed camera movement to the whole shot. Derive camera behavior later from content-adaptive, variable-duration action beats, narrative purpose, and transitions.
8. Treat `sceneName` as the main location, not a single fixed background. When multiple shots share one broad scene, vary sub-locations/background anchors in `actionDesc` and `imagePrompt` while keeping the same whitelisted `sceneName`.
9. Do not let three consecutive shots share the same background, foreground prop, character blocking, and camera framing unless the story explicitly requires a locked-off moment.

## Output Contract

Return ordered `storyboards` with:

- `order`
- `shotType`
- `duration`
- `dialogue`
- `actionDesc`
- `imagePrompt`
- `sceneName`
- `characterNames`

## Project Hooks

- `src/services/llm.ts`: `generateStoryboards`, `polishStoryboardsForProduction`
- `src/app/api/ai/storyboard/route.ts`
- `src/app/api/episodes/[id]/storyboards/route.ts`

## References

- Story orchestrator/checkpoint style workflows.
