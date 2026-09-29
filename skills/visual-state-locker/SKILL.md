---
name: visual-state-locker
description: Use when storyboard, frame, or video generation must preserve a unified visual state across first, middle, and last frames, adjacent shots, and episodes: wardrobe, face, expression, pose, props, scene layout, lighting, atmosphere, and action progress.
---

# Visual State Locker

## Purpose

Turn continuity into a compact state lock before generating or regenerating any frame. The lock keeps clothing, expression, scene, atmosphere, and action progress as one coherent state instead of separate drifting prompt fragments.

## When To Use

- First/middle/last images in one storyboard do not match.
- Adjacent shots or episodes show sudden wardrobe, face, expression, prop, lighting, or scene changes.
- A frame is regenerated inside an existing chain.
- A style or character reference is overpowering the current generated state.

## State Fields

For every visible named character, keep these fields together:

- identity: face structure, age band, hair, body silhouette.
- wardrobe: exact garments, colors, materials, damage, dirt, blood, footwear, accessories.
- expression: emotional state and intensity, gaze direction, mouth/eye state.
- pose/action: body facing, hand positions, step/lean/kneel/fall state, action progress.
- props: item in each hand and object position.
- scene: location, sub-location, foreground/background anchors, blocking.
- atmosphere: time of day, light source direction/color, weather, smoke/dust/cloud/fog density, color palette.

## Rules

1. Use one integrated state lock. Do not let separate clothing, expression, scene, atmosphere, or action instructions contradict each other.
2. Wardrobe is sticky. Once a character has appeared, later frames must copy the current generated wardrobe/state from the latest frame anchor unless the script explicitly changes it.
3. Expression can evolve only by the action beat. It must not jump from pain/fear/exhaustion to calm/heroic beauty without a scripted reason.
4. Scene and atmosphere are sticky within a continuous location. Camera angle can change, but time of day, light direction, weather, dust/fog/cloud state, and palette must remain compatible.
5. Action may change; identity, wardrobe, scene, and atmosphere usually do not. Each frame should state the allowed action delta and the forbidden non-action changes.
6. For middle-frame regeneration, previous and next anchors are both binding. The new frame must interpolate pose/expression/action between them.
7. Character references are identity-only when a frame anchor exists. Style references are render-language-only and must not add clean makeup, ornate robes, jewelry, new props, or new architecture.
8. If a reference image and text conflict, current frame anchors beat character cards and style references for wardrobe, dirt, injury, expression intensity, props, lighting, and scene state.

## Required Prompt Block

Before image/video generation, include a short state lock:

```text
VISUAL STATE LOCK
Anchors: previous/current frame = [...]; next frame = [...].
Wardrobe/body: copy [...]; allowed change = none unless scripted.
Expression: current emotion/intensity = [...]; allowed change = [...].
Pose/action: current frame is [...%] through action; only change [...hands/gaze/body/step].
Props: keep [...] in [...] hand / at [...] position.
Scene/atmosphere: keep [...location, light, weather, fog/dust/cloud, palette].
Forbidden changes: wardrobe swap, jewelry, cleaned face, beauty upgrade, face/age drift, prop changes, extra people, lighting/time jump, new background.
```

## Project Hooks

- `src/services/llm.ts`: storyboard generation and frame/video prompt rewriting.
- `src/services/ai.ts`: frame reference priority, visual state lock assembly, video motion lock.
- `src/services/storyboard-generation-handler.ts`
- `src/app/api/storyboards/[id]/middle-frames/[frameId]/route.ts`
