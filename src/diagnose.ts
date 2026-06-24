import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserSession } from "./browser-session.js";
import { config } from "./config.js";
import { CopilotClient } from "./copilot-client.js";
import { errorMessage } from "./errors.js";

function redact(value: string): string {
  return value
    .replace(/([?&]accessToken=)[^&\s]+/gi, "$1<redacted>")
    .replace(/("accessToken"\s*:\s*")[^"]+/gi, "$1<redacted>");
}

export async function diagnose(interactive = true): Promise<string> {
  await mkdir(config.sessionDir, { recursive: true });
  const lines = [
    "Windows Copilot Agent diagnostic report",
    `node: ${process.version}`,
    `platform: ${process.platform} ${process.arch}`,
    `sessionDir: ${config.sessionDir}`,
  ];
  try {
    const snapshot = JSON.parse(await readFile(path.join(config.sessionDir, "token.json"), "utf8")) as { accessToken?: string; savedAt?: number; cookies?: object };
    lines.push(`token: ${snapshot.accessToken ? `present (len ${snapshot.accessToken.length})` : "missing"}`);
    lines.push(`tokenAgeSeconds: ${snapshot.savedAt ? Math.round((Date.now() - snapshot.savedAt) / 1_000) : "unknown"}`);
    lines.push(`cookies: ${snapshot.cookies ? Object.keys(snapshot.cookies).length : 0}`);
  } catch {
    lines.push("token.json: missing or unreadable");
  }

  if (interactive) {
    const browser = new BrowserSession(false);
    const frames: string[] = [];
    try {
      await browser.start();
      browser.page.on("websocket", (socket) => {
        if (!socket.url().includes("/c/api/chat")) return;
        frames.push(`[OPEN] ${redact(socket.url())}`);
        socket.on("framesent", (payload) => frames.push(`[SENT] ${redact(String(payload))}`));
        socket.on("framereceived", (payload) => frames.push(`[RECV] ${redact(String(payload))}`));
        socket.on("close", () => frames.push("[CLOSE]"));
      });
      // Attach the listener before a fresh document load so sockets opened during
      // application bootstrap are captured as well as sockets opened by a turn.
      await browser.page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      console.log("Send one short message in the browser, wait for the reply, then close the window.");
      const deadline = Date.now() + 5 * 60_000;
      while (!browser.page.isClosed() && Date.now() < deadline) await browser.page.waitForTimeout(500);
    } catch (error) {
      lines.push(`browserCapture: failed: ${errorMessage(error)}`);
    } finally {
      await browser.close();
    }
    await writeFile(path.join(config.sessionDir, "ws_capture.log"), frames.join("\n"), "utf8");
    lines.push(`capturedFrames: ${frames.length}`);
  }

  const client = new CopilotClient();
  try {
    const reply = await client.chat("Reply with exactly one word: pong", { timeoutMs: 60_000 });
    lines.push(`liveProbe: ok (${reply.text.trim().slice(0, 80)})`);
  } catch (error) {
    lines.push(`liveProbe: failed: ${errorMessage(error)}`);
    if (error && typeof error === "object" && "code" in error) lines.push(`errorCode: ${String(error.code)}`);
    if (error && typeof error === "object" && "stage" in error) lines.push(`errorStage: ${String(error.stage)}`);
  } finally {
    await client.close();
  }
  const report = lines.join("\n") + "\n";
  const reportPath = path.join(config.sessionDir, "diagnostic_report.txt");
  await writeFile(reportPath, report, "utf8");
  return reportPath;
}
