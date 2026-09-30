# Reference Image Generation

Use this guide for basic character and scene references.

- Character generation uses the saved appearance description and selected style to request one front-facing full-body image.
- Keep the user's selected model. Do not generate a multiview sheet, rewrite appearance automatically or inspect and retry an image based on quality.
- Let users choose candidates, edit descriptions and regenerate manually. Preserve the previous selected image when generation fails.
- Save images through `src/services/local-media.ts`; bundled style previews remain local files.
- Keep provider input requirements and safety handling. Do not add a public storage service.

Implementation: `src/services/ai.ts`, `src/services/character-reference-job.ts`, and character/scene reference routes.
