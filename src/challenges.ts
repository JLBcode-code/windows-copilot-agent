import { createHash } from "node:crypto";

function hasLeadingZeroBits(digest: Buffer, difficulty: number): boolean {
  const fullBytes = Math.floor(difficulty / 8);
  const remainder = difficulty % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (digest[index] !== 0) return false;
  }
  if (!remainder) return true;
  const value = digest[fullBytes];
  return value !== undefined && (value & (0xff << (8 - remainder))) === 0;
}

export function solveHashcash(parameter: string): string {
  const separator = parameter.lastIndexOf(":");
  if (separator < 0) throw new Error("Invalid hashcash parameter");
  const seed = parameter.slice(0, separator);
  const difficulty = Number(parameter.slice(separator + 1));
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 256) {
    throw new Error("Invalid hashcash difficulty");
  }
  for (let nonce = 0; ; nonce += 1) {
    const digest = createHash("sha256").update(seed + nonce).digest();
    if (hasLeadingZeroBits(digest, difficulty)) return String(nonce);
  }
}

export function solveCopilotChallenge(parameter: string): string {
  const value = Number(parameter);
  if (!Number.isFinite(value)) throw new Error("Invalid Copilot challenge");
  return String(Math.round((value ** 3 / 100 + value * 25) % 22));
}

export function solveChallenge(method?: string, parameter?: string): string | undefined {
  if (!method && !parameter) return "";
  if (method === "hashcash" && parameter) return solveHashcash(parameter);
  if (method === "copilot" && parameter) return solveCopilotChallenge(parameter);
  return undefined;
}
