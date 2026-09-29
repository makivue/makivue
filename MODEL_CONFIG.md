# makivue 模型配置

[返回 README](README.md) · [官网](https://makivue.com?utm_source=github)

每个使用者需要在对应模型供应商申请自己的 Token / API Key。makivue 不提供共享凭证，也不从其他项目读取密钥。

## 配置流程

1. 将项目根目录的 `.env.example` 复制为 `.env`。
2. 填写实际使用的供应商配置；不使用的供应商可以留空。
3. 运行 `npm run models:check` 查看配置状态。
4. 启动或重启服务，在“模型设置”与创作页面选择对应模型。

检查命令不会调用模型或打印密钥，也不会验证余额、模型权限和供应商可用性。它显示所有支持的配置项；未启用的可选供应商不影响启动。

页面只保存模型选择和生成偏好。凭证放在本机 `.env`、注入的环境变量或外部凭证文件中，不应使用 `NEXT_PUBLIC_*` 保存密钥。

## 供应商配置

| 供应商              | 用途                           | 必填内容                                                  |
| ------------------- | ------------------------------ | --------------------------------------------------------- |
| OpenAI / 兼容供应商 | GPT-4o 文本、视频抽帧分析      | `OPENAI_API_KEY`                                          |
| Azure OpenAI        | 文本                           | `AZURE_OPENAI_TEXT_API_KEY`、`AZURE_OPENAI_TEXT_ENDPOINT` |
| Google Vertex AI    | Gemini、Nano Banana、Veo       | 自己的完整服务账号凭证                                    |
| 阿里百炼 DashScope  | Qwen 图片、Wan 视频            | `DASHSCOPE_API_KEY`                                       |
| 火山 Ark            | Seedance 视频                  | `SEEDANCE_API_KEY`、有权限使用的模型 ID                   |
| HiModels（可选）    | 该供应商支持的文本、图片、视频 | `HIMODELS_API_KEY`                                        |

同一供应商下，账号有权限使用的模型可以共用对应密钥；不同供应商的密钥不能混用。模型 ID、地区、配额和输入能力以供应商账号实际可用范围为准。

### OpenAI / 兼容供应商

```dotenv
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-4o
OPENAI_VISION_MODEL=gpt-4o
```

在空值处填写自己的 Key。兼容供应商的 `OPENAI_BASE_URL` 使用主机地址，**不要附加 `/v1`**。参考视频分析需要支持图片输入的 `OPENAI_VISION_MODEL`；当前流程分析抽样画面，不转写音轨。

若使用 Azure 文本模型，还需填写：

```dotenv
AZURE_OPENAI_TEXT_ENDPOINT=
AZURE_OPENAI_TEXT_API_KEY=
```

端点必须是自己账号的有效部署地址，项目没有内置私有部署地址。不同文本任务的模型选择以设置页面为准。

### Google Vertex AI

使用自己的服务账号，确认相关项目已启用所需模型服务并具有调用权限。选择以下任一种方式：

**外部文件方式**

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside-repository/service-account.json
```

服务账号 JSON 放在仓库外。不要把示例路径当作实际配置，也不要将该文件提交到 Git。

**Base64 方式**

```dotenv
NANO_BANANA_SERVICE_ACCOUNT_JSON_B64=
```

将自己的完整服务账号 JSON 编码为单行 Base64 后填写。Base64 不是加密，应与原始私钥同样保护。

### 阿里百炼 DashScope

```dotenv
DASHSCOPE_API_KEY=
```

用于直连 Qwen 图片和 Wan 视频模型。请确认账号权限、所选模型和供应商支持的输入格式。

### 火山 Ark / Seedance

```dotenv
SEEDANCE_API_KEY=
SEEDANCE_20_BASE_URL=https://ark.cn-beijing.volces.com
SEEDANCE_20_MODEL=
SEEDANCE_25_BASE_URL=https://ark.cn-beijing.volces.com
SEEDANCE_25_MODEL=
```

填写自己有权限使用的模型 ID；两个版本可以使用同一账号的 Ark Key。需要官方素材库或人像输入相关能力时，可能还需要自己的 `VOLCENGINE_ACCESS_KEY` 和 `VOLCENGINE_SECRET_KEY`。

### HiModels（可选）

```dotenv
HIMODELS_API_KEY=
HIMODELS_BASE_URL=https://api.himodels.ai
```

仅在使用该供应商的模型时填写。设置页会标明模型来源，请选择与已填写凭证一致的供应商。

## 本地素材与调用费用

- 参考图片、音频和视频从本机读取，并按适配器支持的格式随请求发送给模型供应商。
- 生成结果下载到 `LOCAL_DATA_DIR/media/`，不使用独立云存储或远程业务后端中转。
- 服务端读取模型参考素材的上限为 100 MiB；具体模型可能有更低的尺寸、时长或数量限制。
- 部分供应商流程会将必要素材提交到其官方模型素材服务，该处理受供应商条款约束。
- 费用由供应商向使用者账号结算，失败和重试是否收费以其规则为准。

<a id="docker-credentials"></a>

## Docker 凭证文件

通过 `--env-file .env` 注入环境变量。使用外部 Google 凭证文件时，还需要只读挂载，并将变量改为容器内路径：

```bash
docker run --rm --name makivue \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e LOCAL_DATA_DIR=/app/data \
  -e GOOGLE_APPLICATION_CREDENTIALS=/run/credentials/google.json \
  -v "$PWD/data:/app/data" \
  -v "/absolute/path/outside-repository/service-account.json:/run/credentials/google.json:ro" \
  makivue
```

把宿主机路径替换为自己的文件位置。镜像的构建上下文排除了凭证与个人数据，模型 Key 不应通过 Dockerfile 或构建参数写进镜像。

## 常见配置问题

| 提示或现象          | 检查内容                                                   |
| ------------------- | ---------------------------------------------------------- |
| 缺少模型密钥        | `.env` 是否位于项目根目录、变量名是否正确、服务是否已重启  |
| 401 / 403           | Key 是否有效、账号是否有模型权限、所选模型来源是否正确     |
| 模型不存在          | 核对自己账号可用的模型 ID、部署名称和地区                  |
| 429 / 配额不足      | 查看供应商配额，减少并发；不要连续重复提交                 |
| Google 凭证无法读取 | 文件路径是否可访问、JSON 是否完整、Docker 挂载路径是否正确 |
| 本地素材被模型拒绝  | 核对供应商支持的内联格式、文件尺寸、视频时长和参考数量     |

反馈配置问题时只提供变量名和脱敏错误，不要附上实际 Token、私钥、完整服务账号文件或私人素材。
