# Screenplay Adapter

## Purpose

Convert chapter prose into a short-drama script that is fully dialogue/action based, shootable, and continuous with all previous episodes.

## When To Use

- Generating single-episode scripts.
- Batch-generating scripts.
- Fixing scripts with narration, broken roles, or weak opening/ending states.

## Inputs

- Current chapter content.
- Current chapter synopsis.
- Full previous script/prose context.
- Previous episode anchor and next episode reference.
- Character whitelist and dialogue language setting.
- Episode state plan.

## Rules

1. Dialogue speakers must come from the character whitelist; use narration only when the selected episode format permits it and the information cannot be visualized.
2. Start every scene with a structured scene description and character state. The first scene may use `Opening state: ...` as its initial character state.
3. Write each narrative beat as a visible action with a named subject, starting state, action process, and resulting state.
4. At meaningful emotional changes, describe the trigger, gaze target, facial change, and body or hand reaction instead of naming only an abstract emotion.
5. Add a performance cue before dialogue when tone, volume, pause, or subtext matters.
6. Include `Opening state: ...` in the first scene and `Ending state: ...` in the final scene.
7. Preserve full previous continuity: secrets, props, relationship status, locations, and character emotional states.
8. If a minor unnamed role appears, merge it into an existing character or express it as action.
9. Do not decide shot size, camera position, composition, camera movement, shot duration, or edit transitions; those belong to the storyboard stage.

## Output Contract

Return JSON:

```json
{
    "title": "8 chars max",
    "synopsis": "50 chars max",
    "script": "【场景：具体地点/日夜/内外】\n（场景描述：...）\n（Opening state: ...）\n（表情：...）\n（动作：...）\n角色名：台词...\n（Ending state: ...）"
}
```

## Project Hooks

- `src/services/llm.ts`: `formatPreviousAdaptationContext`, `generateEpisodeScript`
- `src/app/api/ai/script/route.ts`

## References

- Screenplay/director workflow patterns: lock role, state, and scene before dialogue.
