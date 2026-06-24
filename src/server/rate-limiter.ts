export class TokenBucket {
  readonly #ratePerMs: number;
  readonly #capacity: number;
  #tokens: number;
  #updatedAt: number;

  constructor(public readonly rpm: number, burst: number, private readonly now = () => performance.now()) {
    this.#ratePerMs = rpm / 60_000;
    this.#capacity = Math.max(1, Math.floor(burst));
    this.#tokens = this.#capacity;
    this.#updatedAt = now();
  }

  acquire(): { allowed: boolean; retryAfterSeconds: number } {
    if (this.rpm <= 0) return { allowed: true, retryAfterSeconds: 0 };
    const now = this.now();
    this.#tokens = Math.min(this.#capacity, this.#tokens + Math.max(0, now - this.#updatedAt) * this.#ratePerMs);
    this.#updatedAt = now;
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - this.#tokens) / this.#ratePerMs / 1_000)) };
  }
}
