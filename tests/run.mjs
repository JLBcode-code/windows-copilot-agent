import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { solveCopilotChallenge, solveHashcash } from "../dist/challenges.js";
import { handshakeProfiles, parseJsonFrames } from "../dist/protocol.js";
import { messagesToPrompt } from "../dist/server/prompt.js";
import { TokenBucket } from "../dist/server/rate-limiter.js";
import { createApp } from "../dist/server/app.js";

assert.equal(solveCopilotChallenge("2"), String(Math.round((2 ** 3 / 100 + 2 * 25) % 22)));
const nonce = solveHashcash("seed:8");
assert.equal(createHash("sha256").update(`seed${nonce}`).digest()[0], 0);
assert.deepEqual(parseJsonFrames('{"event":"a"}{"event":"b","text":"}"}'), [
  { event: "a" },
  { event: "b", text: "}" },
]);
assert.deepEqual(handshakeProfiles("auto"), ["standard", "no-consents", "send-only"]);
assert.equal(messagesToPrompt([{ role: "user", content: "hello" }]), "hello");
assert.equal(messagesToPrompt([
  { role: "system", content: "Be concise" },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
  { role: "user", content: "Again" },
]), "Be concise\n\nUser: Hi\nAssistant: Hello\nUser: Again\nAssistant:");

let now = 0;
const bucket = new TokenBucket(60, 2, () => now);
assert.equal(bucket.acquire().allowed, true);
assert.equal(bucket.acquire().allowed, true);
assert.equal(bucket.acquire().allowed, false);
now = 1_000;
assert.equal(bucket.acquire().allowed, true);

const fakeClient = {
  async close() {},
  async chat() { return { text: "ok", conversationId: "conversation-1", images: [] }; },
  async *stream() { yield { type: "conversation", conversationId: "conversation-1" }; yield { type: "text", text: "ok" }; },
};
const app = createApp(fakeClient);
assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
const invalid = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: {} });
assert.equal(invalid.statusCode, 400);
const completion = await app.inject({
  method: "POST",
  url: "/v1/chat/completions",
  payload: { model: "copilot", messages: [{ role: "user", content: "hello" }] },
});
assert.equal(completion.statusCode, 200);
assert.equal(completion.json().conversation_id, "conversation-1");
await app.close();
console.log("All unit tests passed.");
