# makivue Workflow Guides

This folder contains project-local workflow skills. They are not third-party executable packages. They are reviewed, project-owned instructions distilled from external workflow research and the current codebase.

## How To Use

- Human workflow: read the relevant `SKILL.md` before changing prompts or pipeline behavior.
- Runtime workflow: use `skills/manifest.json` to map a production stage to one or more skill ids.
- Coding workflow: keep implementation in `src/`; keep reusable basic generation rules and input contracts here.

## Sources Referenced

- ClawHub `open-novel-writing`: staged novel workflow, chapter spec, state before/after planning.
- ClawHub `novel-continuation-ai`: full-context continuation principle.
- ClawHub docs: skill bundles should declare instructions, dependencies, and safe usage boundaries.

External references are inspiration only. Do not install or execute third-party skill code in this project without review.

## Local Skills

- `pipeline-orchestrator`: overall production gates and failure policy.
- `novel-outline-architect`: story bible and outline planning.
- `continuous-chapter-writer`: full-previous-text chapter generation.
- `screenplay-adapter`: chapter-to-short-drama script adaptation.
- `entity-bible-extractor`: character and scene bible extraction.
- `reference-image-director`: style, character, and scene reference image rules.
- `storyboard-orchestrator`: initial editable storyboard drafts.
- `frame-video-generator`: frame and image-to-video generation rules.
- `video-postproduction`: compose and merge rules.
