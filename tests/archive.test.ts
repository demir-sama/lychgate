import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { __clearArchiveCaches, fetchSnapshotHtml, findSnapshot, fromWaybackTimestamp, parseCdx, pickSnapshot, toWaybackTimestamp, type Snapshot } from "@/lib/archive/wayback";
import { mockResolver, mockTransport } from "./helpers";

const snap = (timestamp: string, status = "200"): Snapshot => ({ timestamp, status, original: "https://a.example/", url: `https://web.archive.org/web/${timestamp}/https://a.example/` });

describe("timestamps", () => {
  it("round-trips", () => {
    const d = new Date(Date.UTC(2016, 7, 26, 6, 41, 45));
    expect(toWaybackTimestamp(d)).toBe("20160826064145");
    expect(fromWaybackTimestamp("20160826064145")!.toISOString()).toBe(d.toISOString());
    expect(fromWaybackTimestamp("2016")).toBeNull();
    expect(fromWaybackTimestamp("20160826")!.toISOString()).toBe("2016-08-26T00:00:00.000Z");
  });
});

describe("pickSnapshot", () => {
  const snaps = [snap("20100101000000"), snap("20150601120000"), snap("20150701000000", "404"), snap("20200101000000")];
  it("picks the latest 200 at or before the cite date", () => {
    expect(pickSnapshot(snaps, new Date("2015-08-01T00:00:00Z"))!.timestamp).toBe("20150601120000");
    expect(pickSnapshot(snaps, new Date("2015-06-01T12:00:00Z"))!.timestamp).toBe("20150601120000");
    expect(pickSnapshot(snaps, new Date("2005-01-01T00:00:00Z"))).toBeNull();
  });
  it("without a cite date picks the latest 200", () => {
    expect(pickSnapshot(snaps)!.timestamp).toBe("20200101000000");
    expect(pickSnapshot([])).toBeNull();
    expect(pickSnapshot([snap("20200101000000", "404")])).toBeNull();
  });
  it("property: result is the max 200 snapshot <= cite date, or null iff none exists", () => {
    const ts = fc.date({ min: new Date("1996-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }).map(toWaybackTimestamp);
    fc.assert(
      fc.property(fc.array(fc.tuple(ts, fc.constantFrom("200", "301", "404")), { maxLength: 30 }), fc.date({ min: new Date("1996-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }), (rows, cite) => {
        const list = rows.map(([t, s]) => snap(t, s));
        const got = pickSnapshot(list, cite);
        const limit = toWaybackTimestamp(cite);
        const eligible = list.filter((s) => s.status === "200" && s.timestamp <= limit);
        if (!eligible.length) expect(got).toBeNull();
        else {
          expect(got).not.toBeNull();
          expect(got!.status).toBe("200");
          expect(got!.timestamp <= limit).toBe(true);
          for (const e of eligible) expect(e.timestamp <= got!.timestamp).toBe(true);
        }
      }),
    );
  });
});

describe("parseCdx", () => {
  it("parses CDX JSON rows", () => {
    const rows = parseCdx([
      ["timestamp", "statuscode", "original"],
      ["20150101000000", "200", "http://a.example/"],
    ]);
    expect(rows).toEqual([{ timestamp: "20150101000000", status: "200", original: "http://a.example/", url: "https://web.archive.org/web/20150101000000/http://a.example/" }]);
    expect(parseCdx([])).toEqual([]);
    expect(parseCdx("nope")).toEqual([]);
    expect(parseCdx([["foo"], ["bar"]])).toEqual([]);
  });
});

describe("findSnapshot", () => {
  beforeEach(() => __clearArchiveCaches());
  const resolver = mockResolver();

  it("queries CDX up to the cite date", async () => {
    let query = "";
    const t = mockTransport({
      "https://web.archive.org/cdx/search/cdx*": (u) => {
        query = u.search;
        return Response.json([
          ["timestamp", "statuscode", "original"],
          ["20140101000000", "200", "https://a.example/"],
          ["20150101000000", "200", "https://a.example/"],
        ]);
      },
    });
    const r = await findSnapshot("https://a.example/", new Date("2015-06-01T00:00:00Z"), { transport: t, resolver });
    expect(r).toMatchObject({ source: "cdx", snapshot: { timestamp: "20150101000000" } });
    expect(query).toContain("to=20150601000000");
    expect(query).toContain("filter=statuscode%3A200");
  });

  it("caches per url and cite day", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const t = mockTransport({ "https://web.archive.org/cdx/search/cdx*": Response.json([["timestamp", "statuscode", "original"], ["20150101000000", "200", "https://c.example/"]]) }, calls);
    await findSnapshot("https://c.example/", null, { transport: t, resolver });
    await findSnapshot("https://c.example/", null, { transport: t, resolver });
    expect(calls).toHaveLength(1);
  });

  it("falls back to the availability API when CDX fails", async () => {
    const t = mockTransport({
      "https://web.archive.org/cdx/search/cdx*": 503,
      "https://archive.org/wayback/available*": Response.json({ archived_snapshots: { closest: { status: "200", available: true, timestamp: "20120101000000" } } }),
    });
    const r = await findSnapshot("https://b.example/", null, { transport: t, resolver });
    expect(r).toMatchObject({ source: "availability", snapshot: { timestamp: "20120101000000" } });
  });

  it("availability result after the cite date is not used as a before-cite snapshot", async () => {
    const t = mockTransport({
      "https://web.archive.org/cdx/search/cdx*": 503,
      "https://archive.org/wayback/available*": Response.json({ archived_snapshots: { closest: { status: "200", available: true, timestamp: "20220101000000" } } }),
    });
    const r = await findSnapshot("https://d.example/", new Date("2015-01-01"), { transport: t, resolver });
    expect(r.snapshot).toBeNull();
  });

  it("returns none with an error when both APIs fail, and none for empty CDX", async () => {
    const t = mockTransport({ "https://web.archive.org/cdx/search/cdx*": 503, "https://archive.org/wayback/available*": 503 });
    const r = await findSnapshot("https://e.example/", null, { transport: t, resolver });
    expect(r.snapshot).toBeNull();
    expect(r.error).toBeTruthy();
    const empty = mockTransport({ "https://web.archive.org/cdx/search/cdx*": new Response("") });
    expect((await findSnapshot("https://f.example/", null, { transport: empty, resolver })).snapshot).toBeNull();
    expect((await findSnapshot("https://g.example/", new Date("2015-01-01"), { transport: empty, resolver })).snapshot).toBeNull();
  });

  it("fetches raw snapshot HTML via the id_ endpoint", async () => {
    let asked = "";
    const t = mockTransport({
      "https://web.archive.org/web/*": (u) => {
        asked = u.href;
        return new Response("<p>then</p>", { headers: { "content-type": "text/html" } });
      },
    });
    expect(await fetchSnapshotHtml(snap("20150101000000"), { transport: t, resolver })).toBe("<p>then</p>");
    expect(asked).toBe("https://web.archive.org/web/20150101000000id_/https://a.example/");
    const missing = mockTransport({});
    expect(await fetchSnapshotHtml(snap("20160101000000"), { transport: missing, resolver })).toBeNull();
  });
});
