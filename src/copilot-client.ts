import { BrowserSession } from "./browser-session.js";
import { config } from "./config.js";
import { solveChallenge } from "./challenges.js";
import { CopilotError } from "./errors.js";
import { Mutex } from "./mutex.js";
import { framesForProfile, handshakeProfiles, parseJsonFrames, type HandshakeProfile } from "./protocol.js";
import type { ChatOptions, ChatReply, ImageResponse, StreamEvent } from "./types.js";

export class CopilotClient {
  readonly #browser: BrowserSession;
  readonly #mutex = new Mutex();

  constructor(options: { headless?: boolean } = {}) {
    this.#browser = new BrowserSession(options.headless ?? config.headless);
  }

  async initialize(): Promise<void> {
    await this.#browser.start();
    await this.#browser.ensureAuthenticated();
  }

  async *stream(prompt: string, options: ChatOptions = {}): AsyncGenerator<StreamEvent> {
    if (!prompt.trim()) throw new CopilotError("Prompt must not be empty", "invalid_prompt", "input");
    const release = await this.#mutex.acquire();
    try {
      await this.initialize();
      const conversationId = options.conversationId ?? await this.#browser.createConversation();
      if (!options.conversationId) yield { type: "conversation", conversationId };

      const profiles = handshakeProfiles(config.handshakeProfile);
      let lastError: unknown;
      for (const [index, profile] of profiles.entries()) {
        let emittedContent = false;
        try {
          for await (const event of this.#attempt(prompt, conversationId, profile, options)) {
            if (event.type === "text" || event.type === "image") emittedContent = true;
            yield event;
          }
          return;
        } catch (error) {
          lastError = error;
          const canRetry = error instanceof CopilotError
            && error.code === "invalid_event"
            && !emittedContent
            && index < profiles.length - 1;
          if (!canRetry) throw error;
        }
      }
      throw lastError;
    } finally {
      release();
    }
  }

  async chat(prompt: string, options: ChatOptions = {}): Promise<ChatReply> {
    const text: string[] = [];
    const images: ImageResponse[] = [];
    let conversationId = options.conversationId;
    for await (const event of this.stream(prompt, options)) {
      if (event.type === "conversation") conversationId = event.conversationId;
      else if (event.type === "text") text.push(event.text);
      else images.push(event);
    }
    return { text: text.join(""), conversationId, images };
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }

  async *#attempt(
    prompt: string,
    conversationId: string,
    profile: HandshakeProfile,
    options: ChatOptions,
  ): AsyncGenerator<StreamEvent> {
    const { id, queue } = await this.#browser.openSocket();
    const sendFrame = {
      event: "send",
      conversationId,
      content: [{ type: "text", text: prompt }],
      mode: "smart",
      context: {},
    };
    const startedAt = Date.now();
    let lastEvent = "socket-open";
    let challengeAnswered = false;
    try {
      for (const frame of framesForProfile(profile)) await this.#browser.sendSocket(id, frame);
      await this.#browser.sendSocket(id, sendFrame);

      while (Date.now() - startedAt < (options.timeoutMs ?? config.requestTimeoutMs)) {
        const event = await queue.next(config.idleTimeoutMs, options.signal);
        if (!event) {
          throw new CopilotError(`Copilot socket was idle after ${lastEvent}`, "socket_idle", "stream", { profile, lastEvent });
        }
        if (event.kind === "error") {
          throw new CopilotError(event.data ?? "WebSocket error", "websocket_error", "stream", { profile });
        }
        if (event.kind === "close") {
          throw new CopilotError(`WebSocket closed before completion (${event.data ?? "unknown"})`, "websocket_closed", "stream", { profile, lastEvent });
        }
        if (event.kind !== "message") continue;
        for (const message of parseJsonFrames(event.data)) {
          const name = String(message.event ?? "unknown");
          lastEvent = name;
          if (name === "challenge" && !challengeAnswered) {
            const method = typeof message.method === "string" ? message.method : undefined;
            const parameter = typeof message.parameter === "string" ? message.parameter : undefined;
            const token = solveChallenge(method, parameter);
            if (token === undefined) {
              throw new CopilotError(
                `Copilot requires an unsupported ${method ?? "unknown"} challenge; run \`npm run diagnose\` in a visible browser.`,
                "unsupported_challenge",
                "challenge",
                { method },
              );
            }
            await this.#browser.sendSocket(id, { event: "challengeResponse", token, method, id: message.id });
            challengeAnswered = true;
            await this.#browser.sendSocket(id, sendFrame);
          } else if (name === "appendText") {
            if (typeof message.text === "string") yield { type: "text", text: message.text };
          } else if (name === "imageGenerated") {
            if (typeof message.url === "string") {
              yield {
                type: "image",
                url: message.url,
                prompt: typeof message.prompt === "string" ? message.prompt : undefined,
                metadata: { preview: message.thumbnailUrl },
              };
            }
          } else if (name === "done") {
            return;
          } else if (name === "error") {
            const code = String(message.errorCode ?? message.code ?? "unknown");
            if (code === "invalid-event") {
              throw new CopilotError(
                `Copilot rejected handshake profile '${profile}' with invalid-event`,
                "invalid_event",
                "protocol",
                { profile, message },
              );
            }
            throw new CopilotError(`Copilot error: ${code}`, code, "upstream", message);
          }
        }
      }
      throw new CopilotError("Copilot request timed out", "request_timeout", "stream", { profile, lastEvent });
    } finally {
      await this.#browser.closeSocket(id);
    }
  }
}
