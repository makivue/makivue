# 为 makivue 做贡献

欢迎改进创作体验、模型适配、多语言文案、文档和测试。

[项目介绍](README.zh-CN.md) · [模型配置](MODEL_CONFIG.md) · [官网](https://makivue.com?utm_source=github)

## 提交问题

在本仓库的 Issues 中提供：

- Node.js、操作系统、浏览器和运行方式。
- 当前提交版本、复现步骤、预期结果和实际结果。
- 已脱敏的错误提示；涉及模型时提供供应商和模型名称。
- 尽量小的复现输入，使用可以公开的示例文本或素材。

不要附上 `.env`、Token、服务账号文件、私人素材或完整的个人数据目录。配置问题只需要变量名称和“已填写 / 未填写”状态。

## 本地开发

```bash
npm ci
cp .env.example .env
npm run dev
```

需要 Node.js 22.12+（22 LTS）或 24+、FFmpeg 和 ffprobe。普通测试使用模拟模型响应，不要求填写真实凭证。

涉及 Next.js 行为的变更，请先阅读当前安装版本的 `node_modules/next/dist/docs/`，并遵循 [AGENTS.md](AGENTS.md)。

依赖升级后运行 `npm audit` 并重新验证构建与测试。`package.json` 中的两项 Prisma 依赖覆盖用于修复其固定旧版本带来的安全告警：配置合并使用 `deepmerge-ts` 8，CLI 的间接依赖使用修复后的 `mysql2` 3。保留它们，直到上游依赖已更新；本项目仍只使用 Prisma 生成类型，不连接数据库。

## 修改原则

- 项目记录和媒体继续保存在本地；保留文件锁、原子写入和路径检查。
- 模型直接使用本地使用者提供的供应商凭证；不要加入共享密钥或浏览器端密钥。
- 新模型适配需要说明支持的输入格式、模型权限、超时与失败行为。
- 单元和集成测试使用临时目录与模拟响应；真实模型测试须由运行者明确选择。
- 内置风格图、Logo 与文档图片使用仓库中的本地资源。
- 新增界面文案时同步检查多语言目录，避免破坏已有翻译键。
- 文档中的能力与命令要能对应当前实现，不添加尚未实现的功能承诺。

## 提交 Pull Request

先创建自己的分支，完成相关改动，然后执行：

```bash
npm run build
npm run lint
npm run typecheck
npm test
```

PR 描述应说明解决的问题、用户能观察到的变化，以及实际完成的验证。文档变更请检查内部链接、图片路径和命令；行为变更按影响补充有意义的测试。

不要提交个人数据、`node_modules/`、`.next/`、日志、临时媒体或凭证。提交前可以单独执行：

```bash
npm run security:secrets-check
```

## 维护者同步工具

普通克隆使用 Git 更新即可。`scripts/sync-from-internal.py` 仅用于有独立源目录与私有 `.git/open-source-sync.json` 配置的维护环境；这份配置不随仓库分发。

维护者可先运行 `python3 scripts/sync-from-internal.py` 查看计划，解决冲突并审核后再运行 `python3 scripts/sync-from-internal.py --apply`。本地运行、模型凭证和存储相关改动由保护列表管理，不应被来源项目的业务实现覆盖。

## 授权

本项目采用 [MIT 许可证](LICENSE)。提交贡献时，请确认你有权提供相关代码或素材，并同意你的贡献按该许可证分发。引入第三方内容时保留其版权与许可证声明。
