#!/usr/bin/env node
import { interactiveLogin } from "./auth.js";
import { CopilotClient } from "./copilot-client.js";
import { diagnose } from "./diagnose.js";
import { errorMessage } from "./errors.js";
import { startServer } from "./server/app.js";

async function main(): Promise<void> {
  const [command = "serve", ...args] = process.argv.slice(2);
  if (command === "login") {
    await interactiveLogin();
    return;
  }
  if (command === "ask") {
    const client = new CopilotClient();
    try {
      for await (const event of client.stream(args.join(" ") || "Hello!")) {
        if (event.type === "text") process.stdout.write(event.text);
      }
      process.stdout.write("\n");
    } finally {
      await client.close();
    }
    return;
  }
  if (command === "diagnose") {
    const report = await diagnose(!args.includes("--report-only"));
    console.log(`Diagnostic report written to ${report}`);
    return;
  }
  if (command === "serve") {
    await startServer();
    return;
  }
  throw new Error(`Unknown command '${command}'. Use serve, login, ask, or diagnose.`);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
