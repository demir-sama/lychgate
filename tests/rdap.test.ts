import { describe, expect, it } from "vitest";
import { lookupRdap, parseRdapRegistration, registrableDomain, serverForTld } from "@/lib/domain/rdap";
import { mockResolver, mockTransport } from "./helpers";

const BOOTSTRAP = {
  services: [
    [["com", "net"], ["https://rdap.verisign.example/com/v1/"]],
    [["org"], ["http://rdap.org.example/", "https://rdap.publicinterest.example"]],
  ],
};

describe("rdap helpers", () => {
  it("registrableDomain", () => {
    expect(registrableDomain("www.blog.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("a.b.github.io")).toBe("github.io");
    expect(registrableDomain("localhost")).toBeNull();
  });
  it("parseRdapRegistration", () => {
    expect(parseRdapRegistration({ events: [{ eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" }, { eventAction: "registration", eventDate: "1997-09-15T04:00:00Z" }] })).toBe("1997-09-15T04:00:00.000Z");
    expect(parseRdapRegistration({ events: [{ eventAction: "registration", eventDate: "bad" }] })).toBeUndefined();
    expect(parseRdapRegistration({})).toBeUndefined();
    expect(parseRdapRegistration(null)).toBeUndefined();
  });
  it("serverForTld prefers https and adds a trailing slash", () => {
    expect(serverForTld(BOOTSTRAP, "COM")).toBe("https://rdap.verisign.example/com/v1/");
    expect(serverForTld(BOOTSTRAP, "org")).toBe("https://rdap.publicinterest.example/");
    expect(serverForTld(BOOTSTRAP, "xyz")).toBeNull();
    expect(serverForTld({}, "com")).toBeNull();
  });
});

describe("lookupRdap", () => {
  const resolver = mockResolver();
  const transport = mockTransport({
    "https://data.iana.org/rdap/dns.json": Response.json(BOOTSTRAP),
    "https://rdap.verisign.example/com/v1/domain/registered.com": Response.json({ events: [{ eventAction: "registration", eventDate: "2021-05-01T00:00:00Z" }] }),
    "https://rdap.verisign.example/com/v1/domain/flaky.com": 503,
  });
  it("returns the registration date", async () => {
    expect(await lookupRdap("www.registered.com", { transport, resolver })).toMatchObject({ status: "found", registered: "2021-05-01T00:00:00.000Z", domain: "registered.com" });
  });
  it("maps 404 to not_found", async () => {
    expect(await lookupRdap("free-to-buy.com", { transport, resolver })).toMatchObject({ status: "not_found" });
  });
  it("is unknown when the TLD has no RDAP service, the server errors, or the host has no registrable domain", async () => {
    expect((await lookupRdap("example.xyz", { transport, resolver })).status).toBe("unknown");
    expect((await lookupRdap("flaky.com", { transport, resolver })).status).toBe("unknown");
    expect((await lookupRdap("localhost", { transport, resolver })).status).toBe("unknown");
  });
});
