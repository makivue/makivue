# Novel Outline Architect

## Purpose

Create or refine the story bible and full-series outline so every later chapter, script, storyboard, and video has a stable narrative spine.

## When To Use

- Generating story setup.
- Generating or regenerating outline.
- Turning an existing novel into chapter plans.
- Diagnosing weak story continuity.

## Inputs

- Project title, genre, description.
- Existing full novel or raw story material when available.
- `NovelSetup`: core seed, world bible, plot architecture, character arcs, relationships, key plots, visual style.
- Target episode count and target word count.

## Output Contract

Each chapter must include:

- `chapterNumber`
- `title`
- `synopsis`
- `intensity`
- `openingState`
- `endingState`
- `characterStateChanges`
- `continuityBridge`

## Rules

1. If a full novel/raw material exists, read it as the primary source.
2. Do not discard early foreshadowing, key props, secrets, or relationship changes.
3. Design a non-flat intensity curve with real peaks and valleys.
4. Every chapter must have a visible opening state and visible ending state.
5. `continuityBridge` must describe a shootable transition, not an abstract idea.

## Project Hooks

- `src/services/llm.ts`: `generateOutlineBatch`
- `src/app/api/ai/outline/route.ts`
- `src/lib/novel.ts`: `NovelSetup`, `NovelEpisodeStatePlan`

## References

- ClawHub `open-novel-writing`: staged novel workflow and chapter spec.
