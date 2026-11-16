/** Small promise semaphore. */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(readonly max: number) {
    if (!(max >= 1)) throw new Error("semaphore max must be >= 1");
  }
  get running() {
    return this.active;
  }
  get waiting() {
    return this.queue.length;
  }
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.releaser();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return this.releaser();
  }
  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    };
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Global concurrency cap plus a per-host cap (default 8 per host, spec requirement). */
export class HostLimiter {
  private hosts = new Map<string, Semaphore>();
  private global: Semaphore;
  constructor(
    readonly perHost = 8,
    globalMax = 24,
  ) {
    this.global = new Semaphore(globalMax);
  }
  private forHost(host: string) {
    let s = this.hosts.get(host);
    if (!s) {
      s = new Semaphore(this.perHost);
      this.hosts.set(host, s);
    }
    return s;
  }
  activeFor(host: string) {
    return this.hosts.get(host)?.running ?? 0;
  }
  async run<T>(url: string, fn: () => Promise<T>): Promise<T> {
    let host = "invalid";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      /* keep */
    }
    return this.forHost(host).run(() => this.global.run(fn));
  }
}
