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

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Global concurrency cap plus a per-host cap (default 8 per host, spec requirement).
 * `cool(host, ms)` pauses new requests to a host that answered 429/503.
 */
export class HostLimiter {
  private hosts = new Map<string, Semaphore>();
  private cooldown = new Map<string, number>();
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
  private hostOf(url: string) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "invalid";
    }
  }
  /** Hold new requests to this URL's host for `ms` (extends, never shortens, an existing pause). */
  cool(url: string, ms: number, now = Date.now()) {
    const host = this.hostOf(url);
    this.cooldown.set(host, Math.max(this.cooldown.get(host) ?? 0, now + ms));
  }
  cooledUntil(url: string) {
    return this.cooldown.get(this.hostOf(url)) ?? 0;
  }
  async run<T>(url: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const host = this.hostOf(url);
    const until = this.cooldown.get(host) ?? 0;
    if (until > Date.now()) await sleep(until - Date.now(), signal);
    return this.forHost(host).run(() => this.global.run(fn));
  }
}
