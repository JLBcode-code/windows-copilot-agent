import { randomUUID } from "node:crypto";

export function completionResponse(text: string, model: string, conversationId?: string) {
  return {
    id: `chatcmpl-${randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model,
    conversation_id: conversationId,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function streamChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  conversationId?: string,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
