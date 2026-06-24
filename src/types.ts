export interface ImageResponse {
  type: "image";
  url: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatReply {
  text: string;
  conversationId?: string;
  images: ImageResponse[];
}

export type StreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "text"; text: string }
  | ImageResponse;

export interface SessionSnapshot {
  accessToken: string;
  identityType?: string;
  savedAt: number;
  cookies: Record<string, string>;
}

export interface ChatOptions {
  conversationId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
