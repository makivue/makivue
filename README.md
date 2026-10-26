<div align="center">

<p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.fr.md">Français</a></p>

<a href="https://makivue.com?utm_source=github">
  <img src="public/brand/logo.png" width="72" alt="makivue" />
</a>
<h1>makivue</h1>

**Turn ideas into AI short dramas, anime, images, and videos.**

One local workspace for stories, characters, scenes, storyboards, video, and subtitles.

[Quick start](#quick-start) · [Features](#features) · [Interface](#interface-previews)

[Website](https://makivue.com?utm_source=github) · [Model configuration](MODEL_CONFIG.md) · [Contributing](CONTRIBUTING.md)

**Community:** [WhatsApp](https://chat.whatsapp.com/LGcDrlKUrZ3AbJdO8WSPox?mode=gi_t) · [Telegram](https://t.me/+piA50HGZMaAxNTU1)

</div>

---

makivue brings story development, image creation, asset management, and video production into one workspace. Start with an idea, import a novel or script, create an anime project, or work directly with images and video clips.

**Your projects and media stay on your computer. Models use your own supplier accounts.** Records and media live in local files; generation requests go directly from the local server to your selected supplier.

| 306 preset styles | 9 interface languages |
| :---: | :---: |
| **Local JSON + media** | **Your own model accounts** |

<a id="features"></a>

## Features

### Story and project production

| Capability | What you can do |
| --- | --- |
| **Stories and document import** | Develop outlines and episode scripts, or import TXT, Markdown, DOCX, and PDF documents; review the detected structure before creating the project. |
| **Characters and scenes** | Extract characters and locations, edit their details, manage reference images, and reuse assets across a project. |
| **Storyboard editing** | Adjust shot descriptions, actions, dialogue, framing, camera motion, duration, and first/last-frame prompts. |
| **Styles and themes** | Search **306 presets** by style group and subject category, or save custom styles and regional themes with up to three local reference images. |
| **Anime studio** | Create an anime project or prepare character sheets, storyboard keyframes, and poster prompts, then continue in the image workspace. |
| **Production tasks** | Run batch generation, inspect progress, cancel jobs, resume interrupted supported tasks, and retry individual items manually. |

### Image and video workspaces

| Capability | What you can do |
| --- | --- |
| **Standalone image creation** | Choose a configured image model, prompt, aspect ratio, and supported reference inputs without creating a drama project. |
| **Video generation** | Use text-to-video, image-to-video, reference media, native audio, and first/last frames where supported by the selected model. |
| **Theme video planning** | Turn a travel, product, knowledge, or micro-story topic into an editable visual and audio script; choose narration or ambience before generating a model clip. |
| **Local clip assembly** | Select **2–20 videos from the creator gallery**, reorder or remove clips, and merge up to **10 minutes** with FFmpeg. Choose an output ratio while retaining original audio and fitting frames with padding. |
| **Reference-video tools** | Analyze sampled frames, generate a similar clip, or cut highlights locally. Frame analysis does not transcribe the source audio. |
| **Creator asset gallery** | Preview and download results, reuse prompts and references, change video covers, and select multiple assets for deletion. |
| **Episode export and subtitles** | Assemble shots locally, generate multilingual SRT subtitles from dialogue, switch available subtitle tracks during playback, and download video and subtitle files. |

### Local library and everyday use

| Capability | What you can do |
| --- | --- |
| **Upload library** | Import covers, MP4/MOV/WebM episodes, SRT/VTT subtitles, and cast details. Reorder episodes before saving, track upload progress, and browse the completed work locally. |
| **Workspace storage** | Keep projects, preferences, task progress, model usage records, and media in `LOCAL_DATA_DIR`; back up the complete directory with the service stopped. |
| **Guides and tools** | Browse creation guides and focused image/video tool explainers. |
| **Local feedback** | Save feedback with optional image/video attachments in the local workspace. |
| **Installable app and mobile UI** | Install the PWA where the browser supports it and use responsive creation pages; an offline fallback explains how to reconnect to the local server. |
| **Languages and appearance** | Use English, Chinese, French, Arabic, Indonesian, Hindi, Filipino, Japanese, or Korean, with interface appearance preferences. |

Model formats, duration, resolution, references, and audio depend on the selected model and supplier account. AI generation and subtitle translation require configured suppliers. The PWA does not provide offline model generation.

### Find the right workspace

After starting the local server, open these paths in your browser:

| Start with | Local path | Next step |
| --- | --- | --- |
| A story or script | `/` → `/projects` | Create or import a project, prepare references, then edit and generate shots. |
| A visual style | `/styles` | Explore presets or create a custom style/theme and apply it to a project. |
| An anime idea | `/anime` | Start a project or send a character, keyframe, or poster prompt to the image studio. |
| A picture | `/aiimage` | Generate an image or reuse a result as a reference. |
| A video or topic | `/aivideo` | Choose direct generation, theme planning, or local clip assembly. |
| Existing finished videos | `/upload` → `/uploads` | Upload and organize your own episodes and subtitles. |
| Guidance or feedback | `/guides`, `/tools`, `/feedback` | Read the workflow, explore tools, or save local feedback. |

### Bundled style previews

The repository includes **306 preset styles**: **278 existing model previews** with thumbnails and **28 editorial concept covers**. Concept covers illustrate a style direction rather than a generated result. All previews load from local files without a model key or remote image service.

| Ink painting | Cyberpunk | Claymation | Miniature diorama |
| :---: | :---: | :---: | :---: |
| <img src="public/style-previews/thumbs/256/chinese-ink.webp" width="160" alt="Ink painting" /> | <img src="public/style-previews/thumbs/256/cyberpunk.webp" width="160" alt="Cyberpunk" /> | <img src="public/style-previews/thumbs/256/claymation.webp" width="160" alt="Claymation" /> | <img src="public/style-previews/thumbs/256/miniature-diorama.webp" width="160" alt="Miniature diorama" /> |

<a id="interface-previews"></a>

## Interface previews

![makivue interface in English](docs/screenshots/home-en.webp)

<details>
<summary>See the Chinese and French interfaces</summary>

### 简体中文

![makivue interface in Simplified Chinese](docs/screenshots/home-zh-CN.webp)

### Français

![Interface de makivue en français](docs/screenshots/home-fr.webp)

</details>

<a id="quick-start"></a>

## Quick start

### Requirements

- Node.js 22.12+ (22 LTS) or 24+, with npm.
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

Clone the repository:

```bash
git clone https://github.com/makivue/makivue.git
cd makivue
```

Alternatively, use **Code → Download ZIP**, extract it, and open the project directory. Then install dependencies and prepare your own configuration:

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


## Basic generation edition

This edition keeps the complete creation workflow with manual control over results:

- **Characters:** one full-body reference image per generation, with candidate selection and manual regeneration.
- **Storyboards:** an initial draft from the script; long scripts are processed in batches. Edit actions, dialogue and duration yourself.
- **Illustrations:** a simple prompt with selected character references, without automatic prompt polishing or cross-shot continuity repair.
- **Videos:** generate each shot with your selected model, without automatic model recommendations, comparison runs or multi-segment assembly.
- **Review:** check the output yourself. There is no AI quality scoring, visual inspection, narrative review or quality-triggered regeneration.

Batch generation, cancellation, resumable jobs, manual retries, basic input validation and protection against overwriting newer edits remain available. Provider format and safety requirements still apply. Native first/last-frame inputs remain available where the model supports them.

## Generated video examples

These public examples open the completed first episode on the MakiVue website:

| Work | Episode 1 |
| --- | --- |
| [STOP FIGHTING](https://makivue.com/works/640737770905568823/episodes/640737797782684657) | Watch episode 1 |
| [The 300 Warriors](https://makivue.com/works/640630615397430930/episodes/640630615447762578) | Watch *The Lord of War* |
| [THE LAST IMPACT](https://makivue.com/works/639283952309284093/episodes/639283952326061309) | Watch *The Anomaly* |
| [丛林大冒险](https://makivue.com/works/639471750878378906/episodes/639471750895156122) | 观看《迷雾荧光林》 |
| [星际大战](https://makivue.com/works/638260232912411993/episodes/638260232945966425) | 观看《深空警报与破裂的穹顶》 |

<a id="models"></a>

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
docs/screenshots/        Interface screenshots for documentation
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

This project is licensed under the [MIT License](LICENSE), which permits use, modification, distribution, and commercial use. Retain the copyright and license notice when distributing the code. Model outputs and reference materials are also subject to the relevant supplier and asset terms.

Documentation organization was inspired by [Huobao Drama](https://github.com/chatfire-AI/huobao-drama). Features and setup instructions describe this repository.

---

**Language / 语言 / Langue :** **English** · [简体中文 — 阅读完整中文文档](README.zh-CN.md) · [Français — Lire la documentation française](README.fr.md)
