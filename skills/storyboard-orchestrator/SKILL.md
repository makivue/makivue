# Basic Storyboard Generation

Convert the supplied script into an initial editable storyboard draft.

- Process long scripts in batches without dropping the ending.
- Each shot contains its order, shot type, duration, image description, action, dialogue, narration, character names and scene name.
- Keep the selected text model and video model duration limit.
- Reject empty results or missing image descriptions; normalize optional fields.
- Return independent shots. Do not polish drafts, score coverage, split dialogue automatically, infer cross-shot continuity or generate repair passes.
- Users edit and review the result before generating media.

Implementation: `generateStoryboards` in `src/services/llm.ts`, `src/lib/script-production.ts`, and the storyboard routes.
