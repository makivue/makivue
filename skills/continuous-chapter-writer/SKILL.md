# Continuous Chapter Writer

## Purpose

Generate chapter prose as one continuous long-form story. This skill prioritizes all previous text, not only the latest chapter.

## When To Use

- Generating one chapter.
- Batch-generating all missing chapters.
- Fixing continuity breaks in prose.

## Inputs

- Story bible and full outline.
- Current chapter title and synopsis.
- Current chapter opening/ending state plan.
- All previous chapter content.
- All previous chapter ledger entries.

## Context Policy

1. Full previous text first.
2. If full previous text fits the budget, include all of it.
3. If too long, keep every previous chapter as compressed full text.
4. Never keep only recent chapters.
5. Always include a per-chapter ledger with synopsis and ending anchor.

## Generation Rules

- The chapter must not be isolated from previous story.
- Continue long-term foreshadowing, secrets, props, relationships, and location changes.
- The opening paragraph must naturally connect to the previous chapter ending.
- The ending must land on a stable visual frame.
- If generation fails, retry at least 3 times. If still failing, pause downstream chapters.

## Project Hooks

- `src/services/llm.ts`: `formatPreviousNarrativeContext`, `generateChapter`
- `src/app/api/ai/chapter/route.ts`
- `src/app/projects/[id]/NovelTab.tsx`: batch chapter flow

## References

- ClawHub `novel-continuation-ai`: full-context continuation principle.
- ClawHub `open-novel-writing`: chapter state transition.
