import path from "node:path";

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: numberEnv("PORT", 8000),
  model: process.env.MODEL_NAME ?? "copilot",
  rateLimitRpm: numberEnv("RATE_LIMIT_RPM", 12),
  rateLimitBurst: numberEnv("RATE_LIMIT_BURST", 4),
  requestTimeoutMs: numberEnv("COPILOT_TIMEOUT_MS", 120_000),
  idleTimeoutMs: numberEnv("COPILOT_IDLE_TIMEOUT_MS", 60_000),
  sessionDir: path.resolve(process.env.COPILOT_SESSION_DIR ?? "session"),
  headless: process.env.COPILOT_HEADLESS !== "false",
  handshakeProfile: process.env.COPILOT_HANDSHAKE_PROFILE ?? "auto",
};

export const COPILOT_URL = "https://copilot.microsoft.com/";
export const CHAT_WS_URL = "wss://copilot.microsoft.com/c/api/chat?api-version=2";
