**Choose your language / 选择文档语言 / Choisir la langue**

| English | 简体中文 | Français |
| :---: | :---: | :---: |
| **[Read the English documentation](README.md)** | **完整中文文档** | **[Lire la documentation française](README.fr.md)** |

<div align="center">

<a href="https://makivue.com?utm_source=github">
  <img src="public/brand/logo.png" width="88" alt="makivue" />
</a>

# makivue

**从一个故事想法，到一部 AI 短剧。**

剧本 · 角色 · 场景 · 分镜 · 视频 · 字幕

基于 Next.js、React 与 TypeScript 的本地 AI 短剧创作工作台。

[官网](https://makivue.com?utm_source=github) · [快速开始](#quick-start) · [模型配置](MODEL_CONFIG.md) · [参与贡献](CONTRIBUTING.md)

**加入社区：** [WhatsApp 交流群](https://chat.whatsapp.com/LGcDrlKUrZ3AbJdO8WSPox?mode=gi_t) · [Telegram 交流群](https://t.me/+piA50HGZMaAxNTU1)

</div>

---

makivue 将故事创作、素材管理和视频制作放进同一个项目。你可以从一句创意开始，也可以导入已有小说或剧本，逐步完成角色设计、分镜生成和整集合成。

**项目与素材保存在本机，模型使用你自己的账号。** 本地版无需在线登录、数据库服务或云存储；生成请求由本机服务直接发送给所选模型供应商。

## 基础生成版

此版本保留完整创作流程，生成效果由使用者自行检查和调整：

- **角色：**每次生成一张全身参考图，可选择候选图或手动重新生成。
- **分镜：**根据剧本生成初稿，长剧本分批处理；动作、对白和时长由使用者手动调整。
- **插图：**使用基础提示词和选定角色参考图，不自动润色提示词或修复跨镜头连续性。
- **视频：**每个镜头使用选定模型生成，不提供自动模型推荐、对比生成或多段视频串联。
- **质检：**不进行 AI 评分、视觉检查、正文及剧本复核，也不根据质量结果自动返修。

保留批量生成、任务取消、断点续跑、手动重试、基础输入校验和防止覆盖新内容的保护。仍遵守供应商的格式和安全要求；模型支持时可使用原生首尾帧输入。

## 界面预览

### English

![makivue interface in English](docs/screenshots/home-en.webp)

### 简体中文

![makivue 简体中文界面](docs/screenshots/home-zh-CN.webp)

### Français

![Interface de makivue en français](docs/screenshots/home-fr.webp)

<a id="features"></a>

## 功能亮点

| 能力       | 可以做什么                                                       |
| ---------- | ---------------------------------------------------------------- |
| 故事与剧本 | 从创意生成大纲、分集剧本，或导入 TXT、Markdown、DOCX、PDF 文档   |
| 角色与场景 | 提取角色和场景，管理参考图，在后续创作中复用素材                 |
| 分镜编辑   | 编辑镜头描述、动作、对白、运镜、时长及首尾帧提示词               |
| 图片生成   | 制作角色图、场景图、分镜图，也可独立进行 AI 图片创作             |
| 视频生成   | 按模型能力使用文生视频、图生视频、参考素材和原声生成             |
| 合成与导出 | 使用本机 FFmpeg 合成镜头和整集视频，处理字幕并下载结果           |
| 视频复刻   | 分析参考视频的抽样画面、生成同款片段，或剪出高光片段             |
| 本地工作区 | 保存项目、任务进度、模型调用记录及生成素材                       |
| 多语言界面 | 英语、中文、法语、阿拉伯语、印尼语、印地语、菲律宾语、日语、韩语 |

模型支持的分辨率、时长、参考素材和声音能力各不相同，以当前创作界面和供应商账号权限为准。

### 内置风格预览

代码内附 **278 张风格预览图**及对应缩略图。下图均来自本仓库，加载时无需模型密钥或远程图片服务。

|                                          水墨                                          |                                         赛博朋克                                         |                                         黏土动画                                          |                                             微缩场景                                             |
| :------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------: |
| <img src="public/style-previews/thumbs/256/chinese-ink.webp" width="160" alt="水墨" /> | <img src="public/style-previews/thumbs/256/cyberpunk.webp" width="160" alt="赛博朋克" /> | <img src="public/style-previews/thumbs/256/claymation.webp" width="160" alt="黏土动画" /> | <img src="public/style-previews/thumbs/256/miniature-diorama.webp" width="160" alt="微缩场景" /> |

<a id="quick-start"></a>

## 快速开始

### 1. 准备环境

| 软件             | 要求                                             |
| ---------------- | ------------------------------------------------ |
| Node.js          | 22.12+（22 LTS）或 24+                           |
| npm              | 随 Node.js 安装                                  |
| FFmpeg / ffprobe | 本地安装，并加入 PATH                            |
| 模型账号         | 需要生成时，配置自己对应供应商的 Token / API Key |

macOS 可使用 `brew install ffmpeg`。Windows、Linux 需自行安装 FFmpeg，或使用下方的 Docker 方式。

先确认命令可用：

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

### 2. 获取代码并安装依赖

克隆仓库：

```bash
git clone https://github.com/makivue/makivue.git
cd makivue
```

也可以选择 **Code → Download ZIP**，解压后进入项目目录。然后安装依赖并准备个人配置：

```bash
npm ci
cp .env.example .env
```

Windows PowerShell 可以使用 `Copy-Item .env.example .env`。

编辑 `.env`，仅填写你需要使用的供应商配置。每个使用者必须填写自己的凭证，项目不提供共享 Token。完整说明见[模型配置](MODEL_CONFIG.md)。

### 3. 启动本地工作区

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

无需登录或充值即可创建项目、编辑内容和读取剧本文档。AI 分析、文本、图片及视频生成需要相应模型凭证。进入“模型设置”选择已配置的模型，然后开始创作。

### 4. 检查配置或使用构建版本

```bash
npm run models:check
npm run build
npm start
```

`models:check` 只检查配置是否齐全，不请求供应商、不输出密钥；通过配置检查并不代表账号有权限调用某个模型。修改凭证后需要重启服务。

<a id="workflow"></a>

## 从故事到成片

1. **创建项目**：输入故事想法，或上传自己的小说、剧本文档。
2. **确认剧本**：整理大纲和分集内容，检查人物关系、剧情节奏与对白。
3. **准备素材**：选择风格，生成或导入角色、场景参考图。
4. **编辑分镜**：调整每个镜头的画面、动作、运镜、时长和首尾帧。
5. **生成镜头**：使用已配置的图片、视频模型；可单独重做某个镜头。
6. **合成导出**：确认镜头顺序与字幕，在本机合成整集视频并下载。

建议先用一个短项目走完流程，确认模型权限和输出效果，再进行批量生成。

<a id="models"></a>

## 模型与个人 Token

| 供应商              | 主要用途                                | 个人配置                                                    |
| ------------------- | --------------------------------------- | ----------------------------------------------------------- |
| OpenAI / 兼容供应商 | 文本、参考视频画面分析                  | `OPENAI_API_KEY`，兼容供应商另设 `OPENAI_BASE_URL`          |
| Azure OpenAI        | 文本                                    | `AZURE_OPENAI_TEXT_API_KEY`、`AZURE_OPENAI_TEXT_ENDPOINT`   |
| Google Vertex AI    | Gemini 文本、Nano Banana 图片、Veo 视频 | 自己的服务账号文件或 `NANO_BANANA_SERVICE_ACCOUNT_JSON_B64` |
| 阿里百炼 DashScope  | Qwen 图片、Wan 视频                     | `DASHSCOPE_API_KEY`                                         |
| 火山 Ark            | Seedance 视频                           | `SEEDANCE_API_KEY` 及自己可用的模型配置                     |
| HiModels（可选）    | 其支持的文本、图片和视频模型            | `HIMODELS_API_KEY`                                          |

**密钥放在本机 `.env`、进程环境变量或仓库外的凭证文件中。** 页面设置只保存模型选择和生成偏好，不保存密钥。不同供应商的 Token 不能混用。

模型费用由供应商直接向你的账号结算。调用模型时，所需提示词和参考素材会发给该供应商；生成结果下载并保存到本地。项目保存在本机，不代表生成过程可以完全离线运行。

具体模型选择、Google 凭证、Ark 模型 ID 和 Docker 凭证挂载见 [MODEL_CONFIG.md](MODEL_CONFIG.md)。

<a id="storage"></a>

## 数据保存与备份

默认数据目录是项目根目录下的 `data/`，可通过 `LOCAL_DATA_DIR` 修改。

```text
data/
├── workspace.json    # 项目、偏好、任务与模型调用记录
└── media/            # 图片、视频、音频、字幕等素材
```

- 记录采用文件锁和原子写入；媒体由本机的 `/api/local-media/...` 路由读取。
- 内置风格图在 `public/style-previews/`，随代码分发；项目自己的参考图在数据目录中。
- `public/storage/` 和系统临时目录用于媒体处理过程，不应提交到 Git。
- 备份时先停止服务，再复制整个数据目录；恢复时关闭服务后放回，并检查 `LOCAL_DATA_DIR`。
- 凭证文件需要另外妥善保存，不要放进公开仓库或分享的项目备份。

本地版使用 JSON 文件保存记录，不运行 MySQL、SQLite 或其他数据库。保留的 Prisma schema 用于描述记录结构和生成 TypeScript 类型，不需要执行数据库迁移。

本地工作区面向单用户使用，开发和直接启动默认绑定回环地址。

<a id="docker"></a>

## Docker 运行

镜像包含 Node.js 和 FFmpeg。在项目根目录准备好自己的 `.env` 后执行：

```bash
docker build -t makivue .
docker run --rm --name makivue \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e LOCAL_DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  makivue
```

访问 [http://localhost:3000](http://localhost:3000)。数据卷用于保留项目和素材；`.env` 与用户数据不打包进镜像。上面的续行与路径写法适用于 Bash / Zsh，PowerShell 请调整为对应语法。

若使用 Google 外部凭证文件，需要额外挂载该文件，并将环境变量设置为**容器内路径**，见[配置示例](MODEL_CONFIG.md#docker-credentials)。此运行方式用于本机访问，不是多人公网服务的部署配置。

<a id="development"></a>

## 技术与开发

| 层       | 实现                                 |
| -------- | ------------------------------------ |
| 应用     | Next.js 16、React 19、TypeScript     |
| 样式     | Tailwind CSS 4                       |
| 记录存储 | 本地 JSON、文件锁、原子写入          |
| 媒体处理 | FFmpeg、ffprobe、Sharp               |
| 模型调用 | 本机服务直连供应商，凭证保留在服务端 |

```text
src/app/                 页面和本地服务路由
src/components/          创作界面与公共组件
src/services/            模型适配、媒体处理和生成流程
src/lib/                 本地存储、任务及共享逻辑
src/i18n/                多语言界面与文案
public/style-previews/   内置风格预览和缩略图
docs/screenshots/        文档使用的界面截图
scripts/                 开发、配置检查及维护脚本
prisma/                  记录结构与历史迁移资料
```

```bash
npm run build
npm run lint
npm run typecheck
npm test
```

构建会先检查提交内容中的敏感信息，再生成记录类型。自动化模型测试使用模拟响应，不需要真实 Token；媒体集成测试需要 FFmpeg。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

<a id="faq"></a>

## 常见问题

### 需要购买平台积分或登录官网吗？

本地版不需要。模型调用使用你自己的供应商账号并按其规则计费。[官网](https://makivue.com?utm_source=github)是独立访问入口，不作为本地工作区的业务后端。

### 为什么设置页没有填写 Token 的输入框？

模型凭证属于服务端配置，填写到本机 `.env`。设置页仅保存模型偏好；更新凭证后重启服务。

### 没有配置所有供应商，能启动吗？

可以。只配置实际使用的供应商，并在页面选择对应模型。其他供应商会在调用时提示缺少配置。

### 提示找不到 FFmpeg / ffprobe？

确认两条命令都可在终端执行，也可在 `.env` 设置 `FFMPEG_PATH` 和 `FFPROBE_PATH`。Docker 镜像已包含它们。

### 导入 PDF 没有文字或导入失败？

导入支持 TXT、Markdown、DOCX、PDF，文件上限 8 MiB、提取文本上限 20 万字符。扫描件需要先自行 OCR 为可提取文本的文档；旧版 `.doc` 请先转换为 `.docx`。

### 视频复刻会转写原视频音轨吗？

目前通过视觉模型分析 8 张抽样画面，不转写音轨。同款生成输出一个模型视频片段；高光剪辑由本机 FFmpeg 完成。

### 如何更新？

停止服务并备份数据后，在自己的克隆目录执行 `git pull --ff-only`、`npm ci`。开发模式重新运行 `npm run dev`；使用构建版本时重新执行 `npm run build` 和 `npm start`。保留自己的 `.env` 与数据目录，合并代码冲突后再启动。

## 贡献与授权

欢迎提交问题反馈、文档改进与代码贡献。请提供复现步骤、运行环境和脱敏后的错误信息，具体见[贡献指南](CONTRIBUTING.md)。

本项目采用 [MIT 许可证](LICENSE)，允许使用、修改、分发及商用；分发代码时须保留版权与许可证声明。模型输出和参考素材的使用还需遵守对应供应商与素材的授权条款。

文档组织方式参考 [Huobao Drama](https://github.com/chatfire-AI/huobao-drama)，功能与配置说明按本仓库实现编写。

---

**Language / 语言 / Langue :** [English — Read the English documentation](README.md) · **简体中文** · [Français — Lire la documentation française](README.fr.md)
