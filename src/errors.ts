export class CopilotError extends Error {
  constructor(
    message: string,
    public readonly code = "copilot_error",
    public readonly stage?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CopilotError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
