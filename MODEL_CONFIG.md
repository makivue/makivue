# 本地版模型配置

模型请求由本机 Next.js 服务直接发往所选供应商，密钥来自 `.env` 或进程环境变量。页面只保存模型偏好到本地 JSON。不要从内部项目复制账号或共享密钥。

可用配置见 `.env.example`。只配置需要使用的供应商即可；`npm run models:check` 不调用模型。缺少某个供应商密钥不会阻止应用启动，在选择该供应商生成时会提示缺少配置。

所有 Token / API Key 均由使用者在对应供应商申请，填写到本机 `.env` 后重启。项目不提供共享密钥，也不会从旧内部环境变量读取替代密钥。不同供应商的密钥不能混用；同一账号有权限的模型可共用该供应商密钥。

| 使用的供应商               | 自己需要填写的配置                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| OpenAI / OpenAI 兼容供应商 | `OPENAI_API_KEY`，兼容供应商还需设置自己的 `OPENAI_BASE_URL`                                      |
| Azure OpenAI               | `AZURE_OPENAI_TEXT_API_KEY` 和对应的 `AZURE_OPENAI_TEXT_ENDPOINT`                                 |
| Google Vertex AI           | `NANO_BANANA_SERVICE_ACCOUNT_JSON_B64` 或 `GOOGLE_APPLICATION_CREDENTIALS` 指向自己的服务账号文件 |
| 阿里百炼 Qwen / Wan        | `DASHSCOPE_API_KEY`                                                                               |
| 火山 Ark Seedance          | `SEEDANCE_API_KEY`                                                                                |
| 可选 HiModels              | `HIMODELS_API_KEY`                                                                                |

OpenAI 基础地址使用主机地址，例如 `https://api.openai.com`，文本默认 `gpt-4o`；视频抽帧分析使用 `OPENAI_VISION_MODEL`。Azure 需要显式指定 `AZURE_OPENAI_TEXT_ENDPOINT` 和密钥，没有内置私有部署地址。供应商选择和模型 ID 应以自己的账号实际可用能力为准。

Google Vertex AI 使用自己的服务账号。凭据可通过 `NANO_BANANA_SERVICE_ACCOUNT_JSON_B64` 或外部 `GOOGLE_APPLICATION_CREDENTIALS` 文件传入。DashScope 使用 `DASHSCOPE_API_KEY`；Ark 使用 `SEEDANCE_API_KEY`。可选 HiModels 使用自己的 `HIMODELS_API_KEY`。

本地图片/音视频以内联内容发送给支持该格式的模型接口，输出保存到本机 `data/media`。不通过 local storage 或远程业务后端中转。上传尺寸、格式、可用地区和模型权限仍受供应商限制。
