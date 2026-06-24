import { CopilotClient } from "../src/index.js";

const client = new CopilotClient();
try {
  const reply = await client.chat("Say hello in one short sentence.");
  console.log(reply.text);
  console.log("conversationId:", reply.conversationId);
} finally {
  await client.close();
}
