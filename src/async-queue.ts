export class AsyncQueue<T> {
  #values: T[] = [];
  #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  async next(timeoutMs: number, signal?: AbortSignal): Promise<T | undefined> {
    if (this.#values.length) return this.#values.shift();
    if (this.#closed) return undefined;
    return new Promise<T | undefined>((resolve, reject) => {
      let settled = false;
      const finish = (value?: T, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const waiter = (result: IteratorResult<T>) => finish(result.done ? undefined : result.value);
      this.#waiters.push(waiter);
      const removeWaiter = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
      };
      const timer = setTimeout(() => {
        removeWaiter();
        finish(undefined);
      }, timeoutMs);
      const onAbort = () => {
        removeWaiter();
        finish(undefined, signal?.reason ?? new Error("Aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
