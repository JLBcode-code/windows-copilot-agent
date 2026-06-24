# Windows Copilot Agent

An unofficial Node.js/TypeScript client and OpenAI-compatible local API for Microsoft Copilot consumer chat.

The project runs Copilot requests inside a real Chromium page context. This reuses the browser's TLS fingerprint, cookies, authenticated session, and Cloudflare clearance for both REST and WebSocket traffic.

> This project is not affiliated with or endorsed by Microsoft. Use it responsibly with your own account and in accordance with Microsoft's terms of service.

[简体中文](README.zh-CN.md)

## Features

- TypeScript API for direct chat calls
- OpenAI-compatible Chat Completions endpoint
- Streaming through async iterators and Server-Sent Events
- Multi-turn conversations using `conversation_id`
- Microsoft and Google account sign-in through Chromium
- Persistent browser profile and automatic token reuse
- Browser-native REST and WebSocket transport
- Protocol handshake fallback for `invalid-event` responses
- Hashcash and Copilot challenge solvers
- Serialized upstream requests and token-bucket rate limiting
- Optional local API key authentication
- Diagnostic browser capture with token redaction
- Docker and Docker Compose support
- Graceful browser and server shutdown

## Requirements

- Node.js 20 or later
- Windows, macOS, or Linux
- A Microsoft Copilot account

## Installation

```bash
npm install
npx playwright install chromium
npm run build
```

On Linux, install browser system libraries when necessary:

```bash
npx playwright install --with-deps chromium
```

## Sign in

```bash
npm run login
```

A Chromium window opens at Copilot. Complete the Microsoft or Google sign-in flow and wait for the session to be captured.

Authentication data is stored under `session/`. It contains sensitive cookies, browser state, and access tokens. Do not commit or share it.

## Start the API server

Development mode:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

The server listens on `http://127.0.0.1:8000` by default.

### Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service information |
| `GET` | `/health` | Health check |
| `GET` | `/v1/models` | List the Copilot model |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion |

### Request example

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "copilot",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

The response includes an additional top-level `conversation_id`. Send it in a later request to continue the conversation:

```json
{
  "model": "copilot",
  "conversation_id": "previous-conversation-id",
  "messages": [{"role": "user", "content": "Continue the conversation."}]
}
```

### Streaming

Set `stream` to `true` to receive OpenAI-compatible SSE chunks. The final chunk includes `conversation_id`, followed by `data: [DONE]`.

## Direct Node.js usage

```ts
import { CopilotClient } from "./dist/index.js";

const client = new CopilotClient();
try {
  const first = await client.chat("Remember that my name is Ada.");
  const second = await client.chat("What is my name?", {
    conversationId: first.conversationId,
  });
  console.log(second.text);
} finally {
  await client.close();
}
```

### Direct streaming

```ts
for await (const event of client.stream("Tell me a short joke.")) {
  if (event.type === "text") process.stdout.write(event.text);
  if (event.type === "conversation") {
    console.error("conversationId:", event.conversationId);
  }
}
```

More examples are available in `examples/`.

## CLI and diagnostics

```bash
npm run login
npm run ask -- "Hello"
npm run diagnose
npm run diagnose -- --report-only
```

Diagnostic files are written to:

- `session/diagnostic_report.txt`
- `session/ws_capture.log`

Access tokens in captured WebSocket URLs are redacted. Review diagnostic files before sharing them.

## Docker

Complete interactive sign-in on the host first:

```bash
npm run login
npm run build
docker compose up --build -d
docker compose logs -f
```

Docker Compose mounts the host `session/` directory at `/app/session`. The container reuses the authenticated profile in headless mode.

## Configuration

| Environment variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `8000` | Server port |
| `MODEL_NAME` | `copilot` | Model identifier exposed by the API |
| `API_KEY` | empty | Optional bearer token required for `/v1/*` |
| `RATE_LIMIT_RPM` | `12` | Accepted requests per minute; `0` disables limiting |
| `RATE_LIMIT_BURST` | `4` | Maximum short request burst |
| `COPILOT_TIMEOUT_MS` | `120000` | Overall upstream request timeout |
| `COPILOT_IDLE_TIMEOUT_MS` | `60000` | WebSocket idle timeout |
| `COPILOT_SESSION_DIR` | `session` | Browser profile and token directory |
| `COPILOT_HEADLESS` | `true` | Run the service browser without a visible window |
| `COPILOT_HANDSHAKE_PROFILE` | `auto` | `auto`, `standard`, `no-consents`, or `send-only` |

When binding to `0.0.0.0`, set a strong `API_KEY` and avoid exposing the service directly to the public internet.

## Error responses

Upstream failures use a structured response:

```json
{
  "error": {
    "message": "Error description",
    "type": "upstream_error",
    "code": "invalid_event",
    "stage": "protocol"
  }
}
```

The `stage` field identifies authentication, conversation, WebSocket, challenge, protocol, or streaming failures.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## License

MIT
