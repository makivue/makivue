# Pipeline Orchestrator

## Purpose

Own the end-to-end production order for AI Drama Studio. This skill decides what can run, what must pause, and what quality gate blocks downstream work.

## When To Use

- Building a one-click production flow.
- Adding batch generation.
- Changing stage readiness checks.
- Explaining why a project is blocked.

## Workflow

1. Validate settings before any generation: text model, image provider, video provider, local storage/public URL support, ffmpeg.
2. Run stages in this order:
   settings -> setup -> outline -> chapter -> script -> extract -> reference -> storyboard -> frame -> video -> merge.
3. Treat narrative stages as strong chains:
   outline, chapter, script, and storyboard must pause on final failure.
4. Treat reference images as retryable warnings; frame and video failures block final video.
5. Expose every blocker as an actionable issue.

## Quality Gates

- No downstream stage should run on missing upstream core data.
- A stage can be warning-only only when the output remains usable.
- Every failure message must name the failed stage, episode/storyboard if applicable, and next action.

## Project Hooks

- `src/services/workflow.ts`
- `src/services/pipeline.ts`
- `src/app/api/projects/[id]/pipeline-check/route.ts`

## References

- ClawHub docs: skill bundles declare instructions, dependencies, and safe execution boundaries.
