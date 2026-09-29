# Video Postproduction

## Purpose

Validate generated shot media and merge all shots into final episode videos.

## When To Use

- Burning subtitles.
- Merging episode videos.
- Debugging ffmpeg output.

## Inputs

- `videoUrl`
- Ordered `videoUrl[]`

## Rules

1. Normalize output size, fps, codec, and audio settings before merging.
2. Dialogue subtitle should not cover main faces or key props.
3. Merge must use storyboard order.
4. A missing or invalid shot blocks final episode merge.

## Project Hooks

- `src/services/ffmpeg.ts`: `mergeEpisodeVideos`
- `src/app/api/episodes/[id]/merge/route.ts`

## References

- ffmpeg concat / video merger workflows.
