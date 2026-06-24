export const setOptionsFrame = {
  event: "setOptions",
  supportedFeatures: [
    "partial-generated-images",
    "composer-prefill-conversation-action",
    "composer-send-conversation-action-v2",
    "side-by-side-comparison",
    "session-duration-nudge",
    "compose-email-html",
  ],
  supportedCards: [
    "weather", "local", "image", "sports", "video", "chart", "finance",
    "recipe", "personalArtifacts", "flashcard", "navigation", "person",
    "consentV2", "composeEmail", "createCalendarEvent", "modifyCalendarEvent",
    "deleteCalendarEvent", "practiceTest", "tapToReveal",
  ],
  supportedUIComponents: {
    Badge: "1.2", Basic: "1.2", Box: "1.2", Button: "1.2", Card: "1.2",
    Caption: "1.2", Chart: "1.2", Checkbox: "1.2", Col: "1.2",
    DatePicker: "1.3", Divider: "1.2", Form: "1.2", Icon: "1.2",
    Image: "1.2", Label: "1.2", ListView: "1.2", ListViewItem: "1.2",
    Map: "1.3", Markdown: "1.2", Pressable: "1.3", RadioGroup: "1.3",
    Row: "1.2", Select: "1.3", Spacer: "1.2", Table: "1.3",
    "Table.Cell": "1.3", "Table.Row": "1.3", Text: "1.2",
    Textarea: "1.3", Title: "1.2", Transition: "1.2",
  },
  ads: { supportedTypes: ["text", "product", "multimedia", "tourActivity", "propertyPromotion"] },
  supportedActions: [],
};

export const consentsFrame = { event: "reportLocalConsents", grantedConsents: [] };

export type HandshakeProfile = "standard" | "no-consents" | "send-only";

export function handshakeProfiles(configured: string): HandshakeProfile[] {
  if (configured === "standard" || configured === "no-consents" || configured === "send-only") {
    return [configured];
  }
  return ["standard", "no-consents", "send-only"];
}

export function framesForProfile(profile: HandshakeProfile): unknown[] {
  if (profile === "standard") return [setOptionsFrame, consentsFrame];
  if (profile === "no-consents") return [setOptionsFrame];
  return [];
}

/** Parse one or more concatenated JSON values from a WebSocket message. */
export function parseJsonFrames(input: string): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const parsed: unknown = JSON.parse(input.slice(start, index + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            values.push(parsed as Record<string, unknown>);
          }
        } catch {
          // A malformed diagnostic frame is ignored; valid frames still flow.
        }
        start = -1;
      }
    }
  }
  return values;
}
