# Pipeline Orchestrator

Use this guide when changing makivue's basic generation workflow.

1. Check that the chosen supplier is configured by the user and local media storage and FFmpeg are available.
2. Follow the creation flow: setup → outline → chapter → script → entities → references → storyboards → illustrations → videos → local assembly.
3. Validate required inputs and usable output formats. Do not add AI quality scoring, content review, polishing or quality-triggered regeneration.
4. Preserve job cancellation, recovery, local atomic writes and protection against overwriting newer edits.
5. A failed shot does not prevent independent shots from running. Report its error and allow a manual retry.
6. Require the necessary clips before assembling an episode.

Implementation: `src/services/workflow.ts`, `src/services/pipeline.ts`, and the local project pipeline route.
