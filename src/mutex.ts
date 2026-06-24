export class Mutex {
  #tail = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.#tail;
    this.#tail = previous.then(() => current);
    await previous;
    return release;
  }
}
