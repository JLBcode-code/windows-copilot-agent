export interface ChatMessage {
  role: string;
  content?: string | Array<unknown> | null;
}

export function contentText(content: ChatMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.flatMap((part) => {
    if (part && typeof part === "object" && "type" in part && "text" in part) {
      const typed = part as { type?: unknown; text?: unknown };
      return typed.type === "text" && typeof typed.text === "string" ? [typed.text] : [];
    }
    return [];
  }).join("\n");
}

export function messagesToPrompt(messages: ChatMessage[]): string {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const conversation = messages.filter((message) => message.role !== "system");
  let body: string;
  if (conversation.length === 1 && conversation[0]?.role === "user") {
    body = contentText(conversation[0].content);
  } else {
    body = conversation.map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";
      return `${role}: ${contentText(message.content)}`;
    }).concat("Assistant:").join("\n");
  }
  return [system, body].filter(Boolean).join("\n\n");
}
