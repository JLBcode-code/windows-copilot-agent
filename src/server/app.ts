import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { CopilotClient } from "../copilot-client.js";
import { config } from "../config.js";
import { CopilotError, errorMessage } from "../errors.js";
import { completionResponse, sse, streamChunk } from "./openai.js";
import { messagesToPrompt, type ChatMessage } from "./prompt.js";
import { TokenBucket } from "./rate-limiter.js";

interface ChatCompletionBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  conversation_id?: string;
  [key: string]: unknown;
}

function upstreamError(error: unknown) {
  const typed = error instanceof CopilotError ? error : undefined;
  return {
    error: {
      message: errorMessage(error),
      type: "upstream_error",
      code: typed?.code ?? "upstream_error",
      ...(typed?.stage ? { stage: typed.stage } : {}),
    },
  };
}

export function createApp(client = new CopilotClient()): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
  const limiter = new TokenBucket(config.rateLimitRpm, config.rateLimitBurst);
  const apiKey = process.env.API_KEY;

  app.addHook("onRequest", async (request, reply) => {
    if (!apiKey || !request.url.startsWith("/v1/")) return;
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      return reply.code(401).send({ error: { message: "Invalid API key", type: "authentication_error" } });
    }
  });

  app.get("/", async () => ({
    service: "Windows Copilot Agent",
    status: "ok",
    endpoints: ["/health", "/v1/models", "/v1/chat/completions"],
  }));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/v1/models", async () => ({
    object: "list",
    data: [{ id: config.model, object: "model", created: 0, owned_by: "microsoft" }],
  }));

  app.post<{ Body: ChatCompletionBody }>("/v1/chat/completions", async (request, reply) => {
    if (!Array.isArray(request.body?.messages)) {
      return reply.code(400).send({ error: { message: "messages must be an array", type: "invalid_request_error" } });
    }
    const prompt = messagesToPrompt(request.body.messages);
    if (!prompt.trim()) {
      return reply.code(400).send({ error: { message: "no text content in messages", type: "invalid_request_error" } });
    }
    const limit = limiter.acquire();
    if (!limit.allowed) {
      return reply.header("Retry-After", limit.retryAfterSeconds).code(429).send({
        error: { message: `Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.`, type: "rate_limit_error", code: "rate_limit_exceeded" },
      });
    }
    const model = request.body.model || config.model;
    const options = { conversationId: request.body.conversation_id };

    if (!request.body.stream) {
      try {
        const result = await client.chat(prompt, options);
        return completionResponse(result.text, model, result.conversationId);
      } catch (error) {
        request.log.error(error);
        return reply.code(502).send(upstreamError(error));
      }
    }

    const id = `chatcmpl-${randomUUID().replaceAll("-", "")}`;
    const created = Math.floor(Date.now() / 1_000);
    let conversationId = request.body.conversation_id;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(sse(streamChunk(id, created, model, { role: "assistant" })));
    try {
      for await (const event of client.stream(prompt, options)) {
        if (event.type === "conversation") conversationId = event.conversationId;
        else if (event.type === "text") reply.raw.write(sse(streamChunk(id, created, model, { content: event.text })));
        else reply.raw.write(sse(streamChunk(id, created, model, { image: event })));
      }
      reply.raw.write(sse(streamChunk(id, created, model, {}, "stop", conversationId)));
    } catch (error) {
      request.log.error(error);
      reply.raw.write(sse({ ...streamChunk(id, created, model, {}, "error", conversationId), ...upstreamError(error) }));
    } finally {
      reply.raw.end("data: [DONE]\n\n");
    }
  });

  app.addHook("onClose", async () => client.close());
  return app;
}

export async function startServer(client?: CopilotClient): Promise<FastifyInstance> {
  const app = createApp(client);
  await app.listen({ host: config.host, port: config.port });
  return app;
}
