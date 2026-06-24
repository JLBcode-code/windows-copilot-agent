import { CopilotClient } from "../src/index.js";

const client = new CopilotClient();
try {
  const first = await client.chat("My name is Ada. Remember it.");
  console.log("Copilot:", first.text);
  const second = await client.chat("What is my name?", { conversationId: first.conversationId });
  console.log("Copilot:", second.text);
} finally {
  await client.close();
}
