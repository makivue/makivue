# Basic Illustration and Video Generation

- Request an illustration using the saved image/action description and selected character references.
- Generate one video shot using the user's selected provider. Keep supported native first/last-frame and reference-video inputs.
- Do not add prompt polishing, quality inspection, cross-shot state locks, model recommendations, comparison runs or multi-segment generation.
- Keep required provider safety handling, input validation, bounded network recovery and job polling.
- Batch generation creates one main illustration and one video per shot. Users may request additional illustrations manually.
- Save outputs locally with unique filenames. Preserve cancellation and stale-write guards before committing results.

Implementation: `src/services/ai.ts`, `src/services/storyboard-generation-handler.ts`, `src/services/local-media.ts`, and the episode generation route.
