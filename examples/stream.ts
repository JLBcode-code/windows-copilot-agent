import { CopilotClient } from "../src/index.js";

const client = new CopilotClient();
try {
  for await (const event of client.stream("Tell me a short joke.")) {
    if (event.type === "text") process.stdout.write(event.text);
    if (event.type === "conversation") console.error("conversationId:", event.conversationId);
  }
  process.stdout.write("\n");
} finally {
  await client.close();
}
