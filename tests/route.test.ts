import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/scan/route";
import { ScanInputSchema } from "@/lib/scan/input";

const req = (body: unknown, ip = "203.0.113.50") =>
  new Request("http://localhost/api/scan", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/scan", () => {
  it("validates input", async () => {
    expect((await POST(req("not json", "198.51.100.1"))).status).toBe(400);
    const r = await POST(req({ kind: "site", url: "x" }, "198.51.100.2"));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/url/);
    expect((await POST(req({ kind: "nope" }, "198.51.100.3"))).status).toBe(400);
  });
  it("streams NDJSON events (SSRF targets are sealed without network)", async () => {
    const r = await POST(req({ kind: "markdown", text: "[x](http://169.254.169.254/latest/meta-data/)" }, "198.51.100.4"));
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("meta");
    expect(lines[1]).toMatchObject({ type: "result", result: { cls: "sealed" } });
    expect(lines.at(-1).type).toBe("done");
  });
  it("rate limits per IP", async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await POST(req({ kind: "markdown", text: "no links" }, "198.51.100.99"))).status;
    expect(last).toBe(429);
  });
  it("schema accepts optional empty cite dates and rejects bad ones", () => {
    expect(ScanInputSchema.safeParse({ kind: "markdown", text: "x", citeDate: "" }).success).toBe(true);
    expect(ScanInputSchema.safeParse({ kind: "markdown", text: "x", citeDate: "2015-01-01" }).success).toBe(true);
    expect(ScanInputSchema.safeParse({ kind: "markdown", text: "x", citeDate: "yesterday" }).success).toBe(false);
  });
});
