/** Tiny in-memory TTL + LRU cache (per serverless instance). Stores promises so concurrent callers share one request. */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(
    private ttlMs: number,
    private max = 2000,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.v;
  }
  set(key: string, v: V) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { v, exp: Date.now() + this.ttlMs });
  }
  delete(key: string) {
    this.map.delete(key);
  }
  get size() {
    return this.map.size;
  }
  /** Get-or-create; failed promises are evicted so they can be retried. */
  wrap(key: string, make: () => V): V {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const v = make();
    this.set(key, v);
    if (v instanceof Promise) v.catch(() => this.delete(key));
    return v;
  }
}
