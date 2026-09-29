---
name: visual-continuity-director
description: Use when generating or repairing short-drama storyboards, frame prompts, or videos that must preserve character identity, wardrobe, expression, body state, props, grime/injuries, scene lighting, and previous/next shot continuity across a continuous sequence.
---

# Visual Continuity Director

## Purpose

Maintain a visual state ledger across the script, storyboards, first/middle/last frames, and video prompts so characters do not suddenly change face, age, hair, clothing, expression, injuries, props, or emotional state between adjacent shots.

## When To Use

- A sequence has repeated characters across multiple shots.
- A close-up/detail shot follows a wide/medium shot.
- Characters leave and re-enter after single-character reaction shots.
- Frames show identity, wardrobe, expression, or scene drift.
- Regenerating only part of a shot chain.

## Inputs

- Story bible and current episode state.
- Character cards and reference images.
- Scene cards and reference images.
- Current storyboard plus previous and next storyboards.
- Previous shot ending frame, current shot frames, and any later confirmed frames.
- Existing generated frame/video failure notes.

## Continuity Ledger

For every visible character, keep these fields explicit and current:

- identity: name, age band, face shape, hair color/length/style, body silhouette.
- wardrobe: every garment, color, material, damage, dirt, blood, accessories, footwear.
- state: pose, gaze, expression, emotional intensity, injury, exhaustion, wet/dry/dirty status.
- props: item in each hand, item position, whether it was picked up, dropped, passed, or used.
- blocking: character positions relative to each other and to scene anchors.
- environment: scene name, sub-location, time of day, light direction/color, weather, dust/smoke/cloud state.

## Rules

1. The previous shot ending frame is the highest-priority visual anchor for a continuing character.
2. Character reference images lock identity only after a character has already appeared in the sequence. They must not override current wardrobe, age, grime, injury, lighting, pose, or props.
3. Style reference images lock render language only. They must not introduce new jewelry, ornate clothing, clean makeup, heroic beauty, or architecture into a grounded scene.
4. For close-ups/detail shots, write them as a crop or push-in from the previous frame: whose hand/face/foot/object, exact sleeve/skin/dirt/blood continuity, and what changes.
5. If a shot contains multiple returning characters, collect anchors per character, not just the nearest prior shot. Use the latest frame where each character was visible.
6. If a character exits for one shot and returns, carry forward their last confirmed state unless the script explicitly changes it.
7. Opening state must match the previous confirmed ending state unless there is a declared transition, time jump, scene jump, costume change, or new emotional beat.
8. Ending state must be a stable handoff for the next shot: visible pose, expression, gaze, prop positions, light, and scene anchor.
9. Negative continuity matters: explicitly forbid mismatched outfits, jewelry, cleaned faces, new props, extra characters, age shifts, and sudden beauty upgrades.
10. Partial regeneration must read both sides when available. A redone middle frame is an interpolation between the previous confirmed frame and the next confirmed frame, not a fresh variation from only the previous frame.

## Output Pattern

Before generating or regenerating a shot, prepare a compact continuity note:

```text
CONTINUITY LEDGER
Previous anchor: shot N last frame, [character states].
Current opening must preserve: [identity, wardrobe, dirt/injury, props, light].
Allowed change in this shot: [single action/emotion].
Forbidden changes: [wardrobe swap, jewelry, new prop, face/age drift, extra people].
Next anchor: shot N later frame or shot N+1 first frame, [state that must still be true].
Next handoff: [ending state for shot N+1].
```

## Project Hooks

- `src/services/llm.ts`: storyboard generation and frame prompt rewriting.
- `src/services/ai.ts`: reference image priority and frame prompt assembly.
- `src/app/api/ai/storyboard/route.ts`
- `src/services/storyboard-generation-handler.ts`
- `src/app/api/episodes/[id]/generate-all/route.ts`
