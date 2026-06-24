# Windows Copilot Agent

一个 Node.js/TypeScript Microsoft Copilot 客户端，同时提供兼容 OpenAI 的本地 API。

项目在真实 Chromium 页面上下文中发送 Copilot 请求，因此 REST 和 WebSocket 流量可以复用浏览器的 TLS 指纹、Cookie、登录会话与 Cloudflare 验证状态。

> 本项目与 Microsoft 没有隶属或授权关系。请仅使用自己的账号，并遵守 Microsoft 服务条款。

[English](README.md)

## 功能

- 可直接调用的 TypeScript 聊天客户端
- 兼容 OpenAI Chat Completions 的接口
- 支持异步迭代器和 SSE 流式输出
- 使用 `conversation_id` 继续多轮对话
- 通过 Chromium 登录 Microsoft 或 Google 账号
- 持久化浏览器资料并自动复用令牌
- 浏览器原生 REST 与 WebSocket 传输
- 遇到 `invalid-event` 时自动尝试兼容握手
- 支持 Hashcash 与 Copilot 挑战计算
- 串行执行上游请求并提供 Token Bucket 限流
- 可选的本地 API Key 验证
- 带令牌脱敏的浏览器协议诊断
- 支持 Docker 与 Docker Compose
- 浏览器和服务器优雅关闭

## 环境要求

- Node.js 20 或更高版本
- Windows、macOS 或 Linux
- Microsoft Copilot 账号

## 安装

```powershell
npm install
npx playwright install chromium
npm run build
```

Linux 环境如果缺少浏览器系统依赖：

```bash
npx playwright install --with-deps chromium
```

## 登录

```powershell
npm run login
```

程序会打开 Chromium 并进入 Copilot。完成 Microsoft 或 Google 登录后，等待程序捕获会话。

登录数据保存在 `session/`。其中包含敏感 Cookie、浏览器状态和访问令牌，请勿提交或分享该目录。

## 启动 API 服务

开发模式：

```powershell
npm run dev
```

编译后运行：

```powershell
npm run build
npm start
```

默认监听地址为 `http://127.0.0.1:8000`。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 服务信息 |
| `GET` | `/health` | 健康检查 |
| `GET` | `/v1/models` | 获取 Copilot 模型列表 |
| `POST` | `/v1/chat/completions` | 兼容 OpenAI 的聊天接口 |

### PowerShell 请求示例

```powershell
$body = @{
  model = "copilot"
  messages = @(@{ role = "user"; content = "你好" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/v1/chat/completions `
  -Method Post `
  -ContentType application/json `
  -Body $body
```

响应顶层包含额外的 `conversation_id`。后续请求传回该字段即可继续同一个 Copilot 对话：

```json
{
  "model": "copilot",
  "conversation_id": "previous-conversation-id",
  "messages": [{"role": "user", "content": "继续刚才的对话"}]
}
```

### 流式输出

将 `stream` 设置为 `true` 即可接收兼容 OpenAI 的 SSE 数据。最后一个数据块包含 `conversation_id`，之后发送 `data: [DONE]`。

## 在 Node.js 中直接调用

```ts
import { CopilotClient } from "./dist/index.js";

const client = new CopilotClient();
try {
  const first = await client.chat("记住我的名字是 Ada");
  const second = await client.chat("我的名字是什么？", {
    conversationId: first.conversationId,
  });
  console.log(second.text);
} finally {
  await client.close();
}
```

### 直接流式调用

```ts
for await (const event of client.stream("讲一个简短笑话")) {
  if (event.type === "text") process.stdout.write(event.text);
  if (event.type === "conversation") {
    console.error("conversationId:", event.conversationId);
  }
}
```

更多示例位于 `examples/`。

## CLI 与诊断

```powershell
npm run login
npm run ask -- "你好"
npm run diagnose
npm run diagnose -- --report-only
```

诊断文件输出到：

- `session/diagnostic_report.txt`
- `session/ws_capture.log`

WebSocket URL 中的访问令牌会被脱敏。分享诊断文件前仍应进行人工检查。

## Docker

首先在宿主机完成交互登录：

```powershell
npm run login
npm run build
docker compose up --build -d
docker compose logs -f
```

Docker Compose 会将宿主机的 `session/` 挂载到容器 `/app/session`。容器以无头模式复用已经登录的浏览器资料。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `8000` | 服务端口 |
| `MODEL_NAME` | `copilot` | API 暴露的模型名称 |
| `API_KEY` | 空 | `/v1/*` 接口可选的 Bearer Token |
| `RATE_LIMIT_RPM` | `12` | 每分钟允许的请求数，`0` 表示关闭限流 |
| `RATE_LIMIT_BURST` | `4` | 短时间突发请求容量 |
| `COPILOT_TIMEOUT_MS` | `120000` | 上游请求总超时时间 |
| `COPILOT_IDLE_TIMEOUT_MS` | `60000` | WebSocket 空闲超时时间 |
| `COPILOT_SESSION_DIR` | `session` | 浏览器资料和令牌目录 |
| `COPILOT_HEADLESS` | `true` | 服务浏览器是否使用无头模式 |
| `COPILOT_HANDSHAKE_PROFILE` | `auto` | `auto`、`standard`、`no-consents` 或 `send-only` |

如果监听 `0.0.0.0`，建议设置高强度随机 `API_KEY`，不要把未认证服务直接暴露到公网。

## 错误响应

上游错误使用结构化响应：

```json
{
  "error": {
    "message": "错误说明",
    "type": "upstream_error",
    "code": "invalid_event",
    "stage": "protocol"
  }
}
```

`stage` 用于区分认证、创建会话、WebSocket、挑战处理、协议处理和流式处理阶段。

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

## 许可证

MIT
