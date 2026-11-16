import { afterEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...a: unknown[]) => lookup(...a) }));

const { defaultResolver } = await import("@/lib/fetch/guard");

describe("defaultResolver", () => {
  afterEach(() => lookup.mockReset());

  it("retries transient resolver errors, then caches the answer", async () => {
    lookup.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" })).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await defaultResolver("retry.example")).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(await defaultResolver("RETRY.example")).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("does not retry NXDOMAIN and does not cache failures", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("nx"), { code: "ENOTFOUND" }));
    await expect(defaultResolver("nx.example")).rejects.toMatchObject({ code: "ENOTFOUND" });
    expect(lookup).toHaveBeenCalledTimes(1);
    await expect(defaultResolver("nx.example")).rejects.toMatchObject({ code: "ENOTFOUND" });
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("gives up after three transient failures", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("again"), { code: "EAI_AGAIN" }));
    await expect(defaultResolver("flaky.example")).rejects.toMatchObject({ code: "EAI_AGAIN" });
    expect(lookup).toHaveBeenCalledTimes(3);
  });
  it("maps IPv6 families", async () => {
    lookup.mockResolvedValueOnce([{ address: "2606:4700:4700::1111", family: 6 }]);
    expect(await defaultResolver("v6.example")).toEqual([{ address: "2606:4700:4700::1111", family: 6 }]);
  });
});
