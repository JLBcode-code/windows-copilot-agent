import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type WebSocket as PlaywrightWebSocket } from "playwright";
import { AsyncQueue } from "./async-queue.js";
import { CHAT_WS_URL, COPILOT_URL, config } from "./config.js";
import { CopilotError, errorMessage } from "./errors.js";
import type { SessionSnapshot } from "./types.js";

export type SocketEvent =
  | { kind: "open" }
  | { kind: "message"; data: string }
  | { kind: "error"; data?: string }
  | { kind: "close"; data?: string };

const TOKEN_MAX_AGE_MS = 50 * 60 * 1_000;

export class BrowserSession {
  #context?: BrowserContext;
  #page?: Page;
  #queues = new Map<string, AsyncQueue<SocketEvent>>();
  #snapshot?: SessionSnapshot;
  #starting?: Promise<void>;
  readonly #headless: boolean;

  constructor(headless = config.headless) {
    this.#headless = headless;
  }

  get page(): Page {
    if (!this.#page) throw new CopilotError("Browser session is not started", "browser_not_started", "browser");
    return this.#page;
  }

  async start(): Promise<void> {
    if (this.#page && !this.#page.isClosed()) return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#startInternal();
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async #startInternal(): Promise<void> {
    await mkdir(config.sessionDir, { recursive: true });
    const profileDir = path.join(config.sessionDir, "profile");
    this.#context = await chromium.launchPersistentContext(profileDir, {
      headless: this.#headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    this.#page = this.#context.pages()[0] ?? await this.#context.newPage();
    await this.#page.exposeBinding("__copilotNodeEvent", (_source, id: string, kind: SocketEvent["kind"], data?: string) => {
      this.#queues.get(id)?.push({ kind, data } as SocketEvent);
    });
    this.#page.on("websocket", (socket) => this.#captureTokenFromSocket(socket));
    await this.#loadSnapshot();
    await this.#page.goto(COPILOT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }

  async ensureAuthenticated(): Promise<SessionSnapshot> {
    await this.start();
    const liveToken = await this.findPageToken();
    if (liveToken) {
      await this.#saveSnapshot(liveToken, this.#snapshot?.identityType);
      return this.#snapshot!;
    }
    if (this.#snapshot?.accessToken && Date.now() - this.#snapshot.savedAt < TOKEN_MAX_AGE_MS) {
      return this.#snapshot;
    }
    await this.#sendWarmup();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (this.#snapshot?.accessToken && Date.now() - this.#snapshot.savedAt < 60_000) return this.#snapshot;
      await this.page.waitForTimeout(500);
    }
    throw new CopilotError(
      "No Copilot chat token is available. Run `npm run login` and complete sign-in.",
      "not_authenticated",
      "authentication",
    );
  }

  async findPageToken(): Promise<string | undefined> {
    return this.page.evaluate(() => {
      let fallback: string | undefined;
      for (let index = 0; index < localStorage.length; index += 1) {
        const value = localStorage.getItem(localStorage.key(index) ?? "");
        if (!value?.includes('"credentialType":"AccessToken"')) continue;
        try {
          const parsed = JSON.parse(value) as { secret?: string; target?: string };
          if (parsed.secret && parsed.target?.includes("ChatAI")) return parsed.secret;
          fallback ??= parsed.secret;
        } catch { /* ignore unrelated local storage */ }
      }
      return fallback;
    });
  }

  async isSignedIn(): Promise<boolean> {
    return this.page.evaluate(() => {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.includes("account.keys")) continue;
        try {
          const value = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
          if (Array.isArray(value)) return value.length > 0;
          if (value && typeof value === "object") return Object.keys(value).length > 0;
        } catch { /* continue */ }
      }
      return false;
    });
  }

  async createConversation(): Promise<string> {
    const result = await this.page.evaluate(async () => {
      const response = await fetch("/c/api/conversations", { method: "POST", credentials: "include" });
      return { status: response.status, text: await response.text() };
    });
    if (result.status < 200 || result.status >= 300) {
      throw new CopilotError(`Conversation creation failed: HTTP ${result.status}: ${result.text.slice(0, 300)}`, "conversation_create_failed", "conversation");
    }
    try {
      const data = JSON.parse(result.text) as { id?: string };
      if (!data.id) throw new Error("missing id");
      return data.id;
    } catch {
      throw new CopilotError("Conversation response did not contain an id", "invalid_conversation_response", "conversation");
    }
  }

  async openSocket(): Promise<{ id: string; queue: AsyncQueue<SocketEvent> }> {
    const snapshot = await this.ensureAuthenticated();
    const id = randomUUID();
    const queue = new AsyncQueue<SocketEvent>();
    this.#queues.set(id, queue);
    let url = `${CHAT_WS_URL}&clientSessionId=${randomUUID()}&accessToken=${encodeURIComponent(snapshot.accessToken)}`;
    if (snapshot.identityType) url += `&X-UserIdentityType=${encodeURIComponent(snapshot.identityType)}`;
    await this.page.evaluate(({ socketId, socketUrl }) => {
      const global = window as typeof window & { __copilotSockets?: Map<string, WebSocket>; __copilotNodeEvent: (id: string, kind: string, data?: string) => Promise<void> };
      global.__copilotSockets ??= new Map<string, WebSocket>();
      const socket = new WebSocket(socketUrl);
      global.__copilotSockets.set(socketId, socket);
      socket.onopen = () => void global.__copilotNodeEvent(socketId, "open");
      socket.onmessage = (event) => void global.__copilotNodeEvent(socketId, "message", String(event.data));
      socket.onerror = () => void global.__copilotNodeEvent(socketId, "error", "WebSocket error");
      socket.onclose = (event) => {
        global.__copilotSockets?.delete(socketId);
        void global.__copilotNodeEvent(socketId, "close", `${event.code}:${event.reason}`);
      };
    }, { socketId: id, socketUrl: url });
    const opened = await queue.next(30_000);
    if (opened?.kind !== "open") {
      await this.closeSocket(id);
      throw new CopilotError(`Copilot WebSocket failed to open: ${opened?.data ?? "timeout"}`, "websocket_open_failed", "websocket");
    }
    return { id, queue };
  }

  async sendSocket(id: string, payload: unknown): Promise<void> {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    const sent = await this.page.evaluate(({ socketId, data }) => {
      const global = window as typeof window & { __copilotSockets?: Map<string, WebSocket> };
      const socket = global.__copilotSockets?.get(socketId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(data);
      return true;
    }, { socketId: id, data: text });
    if (!sent) throw new CopilotError("Copilot WebSocket is not open", "websocket_not_open", "websocket");
  }

  async closeSocket(id: string): Promise<void> {
    this.#queues.get(id)?.close();
    this.#queues.delete(id);
    if (!this.#page || this.#page.isClosed()) return;
    await this.#page.evaluate((socketId) => {
      const global = window as typeof window & { __copilotSockets?: Map<string, WebSocket> };
      global.__copilotSockets?.get(socketId)?.close();
      global.__copilotSockets?.delete(socketId);
    }, id).catch(() => undefined);
  }

  async close(): Promise<void> {
    for (const id of [...this.#queues.keys()]) await this.closeSocket(id);
    await this.#context?.close();
    this.#context = undefined;
    this.#page = undefined;
  }

  async #sendWarmup(): Promise<void> {
    for (const selector of ["textarea", "div[contenteditable='true']", "[role='textbox']"]) {
      const locator = this.page.locator(selector).first();
      if (!await locator.isVisible().catch(() => false)) continue;
      await locator.click();
      await locator.fill("hi").catch(async () => locator.pressSequentially("hi", { delay: 15 }));
      await locator.press("Enter");
      return;
    }
    throw new CopilotError("Could not find the Copilot message composer", "composer_not_found", "authentication");
  }

  #captureTokenFromSocket(socket: PlaywrightWebSocket): void {
    try {
      const url = new URL(socket.url());
      if (!url.pathname.includes("/c/api/chat")) return;
      const token = url.searchParams.get("accessToken");
      if (!token) return;
      const identityType = url.searchParams.get("X-UserIdentityType") ?? undefined;
      void this.#saveSnapshot(token, identityType).catch((error) => console.error("Failed to save session:", errorMessage(error)));
    } catch { /* ignore non-chat sockets */ }
  }

  async #saveSnapshot(accessToken: string, identityType?: string): Promise<void> {
    const cookies = Object.fromEntries(
      (await this.#context!.cookies())
        .filter((cookie) => cookie.domain.includes("microsoft.com"))
        .map((cookie) => [cookie.name, cookie.value]),
    );
    this.#snapshot = { accessToken, identityType, cookies, savedAt: Date.now() };
    await writeFile(path.join(config.sessionDir, "token.json"), JSON.stringify(this.#snapshot, null, 2), { mode: 0o600 });
  }

  async #loadSnapshot(): Promise<void> {
    try {
      const raw = await readFile(path.join(config.sessionDir, "token.json"), "utf8");
      const parsed = JSON.parse(raw) as SessionSnapshot;
      if (parsed.accessToken && parsed.savedAt) this.#snapshot = parsed;
    } catch { /* first run */ }
  }
}
