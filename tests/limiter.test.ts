import { describe, expect, it } from "vitest";
import { HostLimiter, Semaphore } from "@/lib/fetch/limiter";
import { RateLimiter } from "@/lib/util/ratelimit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("HostLimiter", () => {
  it("never runs more than 8 requests per host at once", async () => {
    const lim = new HostLimiter(8, 100);
    let active = 0;
    let peak = 0;
    let otherPeak = 0;
    let other = 0;
    const tasks = Array.from({ length: 40 }, (_, i) =>
      lim.run(i % 4 === 0 ? `https://other.example/${i}` : `https://busy.example/${i}`, async () => {
        const busy = i % 4 !== 0;
        if (busy) peak = Math.max(peak, ++active);
        else otherPeak = Math.max(otherPeak, ++other);
        await sleep(5);
        if (busy) active--;
        else other--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBe(8);
    expect(otherPeak).toBeLessThanOrEqual(8);
    expect(otherPeak).toBeGreaterThan(0);
  });
  it("applies a global cap across hosts", async () => {
    const lim = new HostLimiter(8, 3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        lim.run(`https://h${i}.example/`, async () => {
          peak = Math.max(peak, ++active);
          await sleep(3);
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
  it("releases on error", async () => {
    const s = new Semaphore(1);
    await expect(s.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(s.running).toBe(0);
    await expect(s.run(async () => 1)).resolves.toBe(1);
  });
  it("rejects a zero-size semaphore", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});

describe("RateLimiter", () => {
  it("allows `limit` hits per window per key", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check("a", 0).ok).toBe(true);
    expect(rl.check("a", 1).ok).toBe(true);
    const third = rl.check("a", 2);
    expect(third.ok).toBe(false);
    expect(third.retryAfterS).toBe(1);
    expect(rl.check("b", 2).ok).toBe(true);
    expect(rl.check("a", 1001).ok).toBe(true);
  });
});
