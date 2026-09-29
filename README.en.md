<div align="center">

<a href="https://makivue.com?utm_source=github">
  <img src="public/brand/logo.png" width="88" alt="makivue" />
</a>

# makivue

**Turn a story idea into an AI short drama.**

Scripts · Characters · Scenes · Storyboards · Video · Subtitles

A local AI creation workspace built with Next.js, React, and TypeScript.

[Website](https://makivue.com?utm_source=github) · [Quick start](#quick-start) · [Model configuration](MODEL_CONFIG.md) · [Contributing](CONTRIBUTING.md)

[简体中文](README.md) | **English**

</div>

---

makivue brings story development, asset management, and video production into one project. Start with an idea or import an existing novel or script, then develop characters, storyboard shots, and assemble an episode.

**Your projects and media stay on your computer. Models use your own supplier accounts.** The local edition needs no online login, database service, or cloud storage. The local server sends generation requests directly to your selected supplier.

## Features

| Capability            | What you can do                                                                         |
| --------------------- | --------------------------------------------------------------------------------------- |
| Stories and scripts   | Develop outlines and episode scripts; import TXT, Markdown, DOCX, or PDF                |
| Characters and scenes | Extract entities, manage reference images, and reuse assets                             |
| Storyboard editing    | Adjust actions, dialogue, framing, camera movement, duration, and keyframe prompts      |
| Image creation        | Generate character, scene, and storyboard images, or use the standalone image workspace |
| Video generation      | Use text, images, references, and native audio where the chosen model supports them     |
| Assembly and export   | Compose shots and episodes with local FFmpeg, process subtitles, and download results   |
| Reference video tools | Analyze sampled frames, generate a similar clip, or cut highlights                      |
| Local workspace       | Save project records, task progress, model usage records, and generated media           |
| Languages             | Chinese, English, French, Arabic, Indonesian, Hindi, Filipino, Japanese, and Korean     |

Available formats, duration, resolution, and reference inputs depend on the selected model and your supplier account.

### Bundled style previews

The repository includes **278 style previews** and their thumbnails. These examples load from local files without a model key or remote image service.

|                                          Ink painting                                          |                                         Cyberpunk                                         |                                         Claymation                                          |                                             Miniature diorama                                             |
| :--------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------: |
| <img src="public/style-previews/thumbs/256/chinese-ink.webp" width="160" alt="Ink painting" /> | <img src="public/style-previews/thumbs/256/cyberpunk.webp" width="160" alt="Cyberpunk" /> | <img src="public/style-previews/thumbs/256/claymation.webp" width="160" alt="Claymation" /> | <img src="public/style-previews/thumbs/256/miniature-diorama.webp" width="160" alt="Miniature diorama" /> |

## Quick start

### Requirements

- Node.js 22 or newer and npm.
- FFmpeg and ffprobe available on your PATH; on macOS, use `brew install ffmpeg`.
- Your own credentials for any model suppliers you intend to use.

Check your installation:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

### Install and run

Clone this repository using its **Code** menu, or download and extract the ZIP. In the project root:

```bash
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

Edit `.env` and fill in **your own** supplier credentials. The project ships no shared Token or API key. Then start the workspace:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create and edit projects or read script documents without signing in. AI analysis and generation require the relevant credentials. Select a configured model in Settings before generating.

To inspect configuration or run a production build locally:

```bash
npm run models:check
npm run build
npm start
```

The configuration check makes no supplier requests and prints no secrets. It checks configuration presence, not account permissions. Restart the server after changing credentials.

## Creation workflow

1. Create a project from an idea or your own script.
2. Review the outline, episode structure, characters, and dialogue.
3. Choose a style and prepare character and scene references.
4. Edit shot descriptions, actions, camera motion, duration, and keyframes.
5. Generate images and video shots; retry individual shots when needed.
6. Review the sequence and subtitles, then assemble and export locally.

Start with a short project to confirm model access and output quality before submitting batch jobs.

## Models and credentials

| Supplier                     | Main use                                   | Your configuration                                                   |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| OpenAI / compatible supplier | Text and reference-video frame analysis    | `OPENAI_API_KEY`, plus `OPENAI_BASE_URL` for a compatible supplier   |
| Azure OpenAI                 | Text                                       | `AZURE_OPENAI_TEXT_API_KEY` and `AZURE_OPENAI_TEXT_ENDPOINT`         |
| Google Vertex AI             | Gemini text, Nano Banana images, Veo video | Your service account file or `NANO_BANANA_SERVICE_ACCOUNT_JSON_B64`  |
| Alibaba DashScope            | Qwen images and Wan video                  | `DASHSCOPE_API_KEY`                                                  |
| Volcengine Ark               | Seedance video                             | `SEEDANCE_API_KEY` and model configuration available to your account |
| HiModels, optional           | Supported text, image, and video models    | `HIMODELS_API_KEY`                                                   |

Credentials belong in the ignored `.env`, process environment, or an external credential file. The web UI saves model preferences, not credentials.

Suppliers bill your own accounts. Prompts and required references are sent to the selected supplier; generated media is saved locally. Local project storage does **not** make model generation offline. See [model configuration](MODEL_CONFIG.md) for details.

## Storage and backups

The default data directory is `data/`. Set `LOCAL_DATA_DIR` to use another location.

```text
data/
├── workspace.json    # Projects, preferences, tasks, and model usage records
└── media/            # Images, video, audio, and subtitles
```

Records use file locking and atomic writes. Local media is served by `/api/local-media/...`. Bundled previews live in `public/style-previews/`; project references live in the data directory. `public/storage/` and OS temporary directories are used during media processing.

Stop the application before copying the entire data directory for a backup or restore. Keep credentials separately and never include them in public repositories or shared backups.

Runtime records use JSON files, not MySQL or SQLite. The retained Prisma schema generates record types; do not run database migrations. This workspace is intended for one local user, with direct startup bound to loopback.

## Docker

The image includes Node.js and FFmpeg. Prepare your own `.env`, then run:

```bash
docker build -t makivue .
docker run --rm --name makivue \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e LOCAL_DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  makivue
```

Open [http://localhost:3000](http://localhost:3000). The volume preserves project data; credentials and user data are excluded from the image. Commands above use Bash / Zsh syntax.

An external Google credential file must be mounted separately with its **container path** configured. See the [credential mount example](MODEL_CONFIG.md#docker-credentials). This setup is for local access, not a public multi-user deployment.

## Development

The application uses Next.js 16, React 19, TypeScript, Tailwind CSS 4, JSON files, FFmpeg, ffprobe, and Sharp.

```text
src/app/                 Pages and local service routes
src/components/          Shared and creation UI
src/services/            Model adapters, media processing, generation workflows
src/lib/                 Local persistence, task handling, shared logic
src/i18n/                Interface translations
public/style-previews/   Bundled previews and thumbnails
scripts/                 Development, configuration, and maintenance tools
prisma/                  Record schemas and inactive migration history
```

```bash
npm run build
npm run lint
npm run typecheck
npm test
```

Builds check committed content for sensitive information and generate record types. Model tests use mock responses; media integration tests need FFmpeg. See [CONTRIBUTING.md](CONTRIBUTING.md).

## FAQ

### Do I need platform credits or a website account?

No. The local edition uses your supplier accounts. The [website](https://makivue.com?utm_source=github) is a separate destination, not the local workspace's business backend.

### Where do I enter API keys?

In your local `.env`, followed by a server restart. Settings stores generation preferences only. You only need to configure suppliers you use.

### FFmpeg or ffprobe is missing?

Make both commands available on PATH, or set `FFMPEG_PATH` and `FFPROBE_PATH`. Both tools are included in the Docker image.

### Why does document import fail?

Supported inputs are TXT, Markdown, DOCX, and PDF, up to 8 MiB and 200,000 extracted characters. Scanned PDFs need OCR before import. Convert older `.doc` files to `.docx`.

### Does reference-video analysis transcribe audio?

It analyzes eight sampled frames with a vision model and does not transcribe audio. Similar-video generation produces one model clip; highlight cuts use local FFmpeg.

### How do I update?

Stop the service and back up your data. Run `git pull --ff-only` and `npm ci` in your clone. Restart development mode, or rebuild with `npm run build` before `npm start`. Preserve your `.env` and data directory, and resolve local code conflicts before starting again.

## Contributing and licensing

Issues, documentation improvements, and code contributions are welcome. Include reproduction steps and sanitized error messages; see the [contribution guide](CONTRIBUTING.md).

This repository currently has no `LICENSE` file. Licensing terms remain to be published by the maintainer. Model outputs and reference materials are also subject to the relevant supplier and asset terms.

Documentation organization was inspired by [Huobao Drama](https://github.com/chatfire-AI/huobao-drama). Features and setup instructions describe this repository.
