# 本地风格预览图

内置图片保存在 `public/style-previews/<key>.webp`，缩略图位于 `thumbs/256/` 和 `thumbs/384/`。它们属于源码资源，随 Git 和 Docker 镜像发布，页面只读取本机路径。

使用自己的 Google Vertex AI 凭据重新生成指定风格：

```bash
npm run style-previews:generate -- --dry-run --only chinese-ink
npm run style-previews:generate -- --only chinese-ink
```

只有第二条命令会调用模型并产生供应商费用。原图和缩略图直接写入上述源码目录，审核后提交。`--out-dir` 用于保留生成过程的本机临时源文件；失败时可从原目录继续。使用 `--force` 重新生成已完成的项目。

本地 `GET/POST /api/admin/style-previews` 支持预检查和写入准备好的 PNG、JPEG、WebP：单张不超过 32 MiB / 40 百万像素，拒绝动画、损坏图片和不安全路径。接口返回本机 URL，不需要发布令牌或云存储账号。

自定义项目参考图保存到 `data/media/style/`，属于用户数据，不提交到 Git。凭据仅放在 Git 忽略的环境文件或外部凭据文件中。
