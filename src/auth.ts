import { BrowserSession } from "./browser-session.js";
import { errorMessage } from "./errors.js";

export async function interactiveLogin(timeoutMs = 5 * 60_000): Promise<void> {
  const browser = new BrowserSession(false);
  try {
    await browser.start();
    console.log("A browser is open at copilot.microsoft.com.");
    console.log("Sign in with your Microsoft or Google account; the window closes after the chat token is captured.");
    const deadline = Date.now() + timeoutMs;
    let warmupAttempted = false;
    while (Date.now() < deadline) {
      const token = await browser.findPageToken();
      if (token) {
        await browser.ensureAuthenticated();
        console.log("Copilot session saved.");
        return;
      }
      if (!warmupAttempted && await browser.isSignedIn()) {
        warmupAttempted = true;
        try {
          await browser.ensureAuthenticated();
          console.log("Copilot session saved.");
          return;
        } catch (error) {
          console.warn("Automatic token capture did not finish:", errorMessage(error));
          console.warn("Send one short message in the browser to finish token capture.");
        }
      }
      await browser.page.waitForTimeout(500);
    }
    throw new Error("Sign-in timed out after 5 minutes");
  } finally {
    await browser.close();
  }
}
