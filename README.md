# Local Drama Studio — 本地版

基于 Next.js 16、React 19 和 TypeScript 的 AI 短剧创作工作区。项目、剧本、角色、场景、分镜、任务记录和生成素材保存在本机；不需要数据库、云存储、远程业务后端。文本、图片、视频生成使用你自己的模型供应商账户，由本机服务直接请求供应商。

## 启动

需要 Node.js 22+、npm，以及可在命令行运行的 `ffmpeg` 和 `ffprobe`。macOS 可用 `brew install ffmpeg`。

```bash
npm ci
cp .env.example .env
# 编辑 .env，只填写需要使用的模型密钥
npm run dev
```

打开 http://localhost:3000 。无需登录或充值；没有模型密钥时仍可创建、编辑和导入项目。模型生成费用由供应商直接向你的账户结算。

```bash
npm run models:check  # 仅检查配置，不联网、不显示密钥
npm run build
npm start
```

开发和正式启动均绑定本机回环地址。浏览器访问的 `/api/*` 是同一台机器上的本地服务，不会代理到内部项目或其他业务服务器。不要将这个单用户工作区暴露到公网。

## 本地文件与备份

默认数据目录为项目下的 `data/`，可通过 `LOCAL_DATA_DIR` 指定其他位置：

- `workspace.json`：项目内容、生成偏好、任务和模型调用记录。ID 以字符串保存，金额/精度类型在读取时恢复。
- `media/`：图片、视频、音频和字幕。浏览器通过 `/api/local-media/...` 读取本机文件，视频支持分段播放。
- FFmpeg 的处理过程还会使用本机临时文件；`public/storage/` 属于工作文件目录，不能提交到 Git。

记录写入采用文件锁、事务和原子替换。退出应用后复制整个数据目录即可备份；恢复时关闭应用，将备份放回原位置。源码更新不会替你迁移、上传或删除个人数据。该实现适用于本机单用户工作，不适合多主机共享目录或海量数据。

保留的 `prisma/schema.prisma` 只描述记录结构，并为 TypeScript 生成类型。运行时不创建 Prisma 数据库客户端、不连接 MySQL/SQLite，也不执行 SQL 或数据库迁移。`prisma/migrations/` 是上游历史资料，本地版不运行它。

## 内置风格图片

278 张真实风格预览图随代码保存在 `public/style-previews/*.webp`，256px / 384px 缩略图在对应的 `thumbs/` 子目录。首页与风格选择器只读取本机 `/style-previews/...`；无需 云存储、CDN 或模型密钥，不支持远程图片地址覆盖。

更新某张风格图可用自己的模型凭据运行 `npm run style-previews:generate -- --only chinese-ink`。脚本直接请求模型，将图片和缩略图写入上述源码目录，审核后可随 Git 提交。`--dry-run` 仅列出计划，不调用模型。自定义项目参考图保存在本机 `data/media/style/`。

## 模型设置

密钥只放在 Git 忽略的 `.env`、外部凭据文件或进程环境变量中。页面设置只保存模型选择，不保存密钥。

**每个使用者必须自行申请并填写所选供应商的 Token / API Key。项目不附带可用密钥，也不读取内部开发或共享密钥。** 同一供应商的模型可使用同一个有权限的账号密钥；不同供应商的 Token 不能混用。未填写时该供应商无法生成，但本地项目编辑仍可使用。填写或更换密钥后重启应用。

- OpenAI / 兼容供应商：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。文本选择器提供 GPT-4o。
- Google Vertex AI：自己的服务账号，用于 Gemini、Nano Banana 和 Veo。
- 阿里百炼：`DASHSCOPE_API_KEY`，用于 Qwen 图片和 Wan 视频。
- 火山 Ark：`SEEDANCE_API_KEY` 及自己的模型配置，用于 Seedance。
- 可选 HiModels：自己的 `HIMODELS_API_KEY`，直接请求该供应商。

模型输入中的本地素材随请求转换为内联内容，生成结果下载到本机，不使用 云存储 中转。供应商必须支持对应请求的内联素材格式、大小和模型能力；服务端请求参考素材上限为 100 MiB，具体供应商可能更低。调用模型时，提示词和选中的素材会发送给该供应商处理。

视频复刻使用 `OPENAI_VISION_MODEL` 对 8 张抽样画面进行分析，不转写音轨。同款生成产出一个模型视频片段；高光剪辑由本机 FFmpeg 完成，保留原画幅和原声。任务记录保存在本地，已提交的视频任务可在重启后继续查询。中断的分析不自动重复收费调用。

## Docker（可选）

```bash
docker build -t local-drama-studio .
docker run --rm -p 127.0.0.1:3000:3000 \
  --env-file .env -e LOCAL_DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" local-drama-studio
```

镜像内包含 FFmpeg。凭据和本地数据不会复制到镜像；使用数据卷保存项目。

## 更新与同步

这个目录是内部项目的独立副本。以后在此目录预览并应用已审核的上游变更：

```bash
python3 scripts/sync-from-internal.py
python3 scripts/sync-from-internal.py --apply
git diff
npm run build
npm run lint
npm run typecheck
npm test
```

本地同步配置位于 `.git/open-source-sync.json`，不会发布。工具拒绝复制环境文件、用户数据、素材、依赖和私有 Git 历史。本地存储、身份、模型传输、运行配置等有独立修改的文件受保护，上游更新这些文件时必须人工合并，不能恢复数据库、云存储 或远程业务实现。新增文件需审核后通过 `--include` 加入；详细参数见 `--help`。

没有内部源目录和本地同步配置的公开克隆不需要运行此工具，正常使用 Git 更新即可。

## 检查与发布

```bash
npm run build  # 包含凭据扫描和类型生成
npm run lint
npm run typecheck
npm test
```

模型和本地存储测试使用临时目录、模拟供应商响应；不需要真实数据库或收费模型。FFmpeg 集成测试需要本机安装 FFmpeg。

这个副本使用独立 Git 历史。正式公开前仍需由项目所有者选择许可证，并确认代码、品牌和素材的公开授权；当前未添加许可证。当前运行方式以本文和 AGENTS.md 为准；公开文档不包含内部账号、商业报价或部署配置。
