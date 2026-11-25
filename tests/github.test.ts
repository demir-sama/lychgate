import { describe, expect, it } from "vitest";
import { citeDatesFromHistory, fetchRaw, GitHubClient, NotFoundError, parseRepoInput, RateLimitError, rankMarkdownPaths } from "@/lib/github/repo";
import { mockResolver, mockTransport } from "./helpers";

describe("parseRepoInput", () => {
  it.each([
    ["owner/repo", { owner: "owner", repo: "repo" }],
    ["https://github.com/owner/repo", { owner: "owner", repo: "repo" }],
    ["https://github.com/owner/repo.git", { owner: "owner", repo: "repo" }],
    ["github.com/owner/repo/", { owner: "owner", repo: "repo" }],
    ["https://github.com/o/r/tree/main/docs", { owner: "o", repo: "r", ref: "main", path: "docs" }],
    ["o/r/blob/master/README.md", { owner: "o", repo: "r", ref: "master", path: "README.md" }],
  ])("parses %s", (input, want) => {
    expect(parseRepoInput(input)).toEqual(want);
  });
  it.each(["", "https://gitlab.com/o/r", "https://github.com/onlyowner", "o", "https://github.com/o/..", "javascript:alert(1)"])("rejects %s", (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });
});

describe("rankMarkdownPaths", () => {
  it("puts README first, then docs, skips vendored dirs, caps at 20", () => {
    const paths = ["src/a.ts", "node_modules/x/README.md", "CHANGELOG.md", "docs/guide.md", "README.md", "deep/a/b/c.md", ...Array.from({ length: 30 }, (_, i) => `notes/n${i}.md`)];
    const r = rankMarkdownPaths(paths);
    expect(r[0]).toBe("README.md");
    expect(r[1]).toBe("docs/guide.md");
    expect(r).not.toContain("node_modules/x/README.md");
    expect(r).not.toContain("src/a.ts");
    expect(r).toHaveLength(20);
  });
  it("can be scoped to a sub-path", () => {
    expect(rankMarkdownPaths(["README.md", "docs/a.md", "docs/b.mdx"], "docs")).toEqual(["docs/a.md", "docs/b.mdx"]);
  });
});

describe("citeDatesFromHistory", () => {
  const commits = [
    { sha: "c4", date: "2020-04-01T00:00:00Z" },
    { sha: "c3", date: "2019-03-01T00:00:00Z" },
    { sha: "c2", date: "2018-02-01T00:00:00Z" },
    { sha: "c1", date: "2017-01-01T00:00:00Z" },
  ];
  const contents: Record<string, string> = {
    c4: "https://old.example https://mid.example https://new.example",
    c3: "https://old.example https://mid.example",
    c2: "https://old.example",
    c1: "https://old.example",
  };
  it("finds the commit that introduced each URL with few reads", async () => {
    const reads: string[] = [];
    const out = await citeDatesFromHistory(["https://old.example", "https://mid.example", "https://new.example", "https://absent.example"], commits, async (sha) => {
      reads.push(sha);
      return contents[sha];
    });
    expect(out.get("https://new.example")).toMatchObject({ date: "2020-04-01T00:00:00Z", exact: true });
    expect(out.get("https://mid.example")).toMatchObject({ date: "2019-03-01T00:00:00Z", exact: true });
    expect(out.get("https://old.example")).toMatchObject({ date: "2017-01-01T00:00:00Z", sha: "c1" });
    expect(out.has("https://absent.example")).toBe(false);
    expect(new Set(reads).size).toBe(reads.length); // memoised
  });
  it("marks dates as upper bounds when history is truncated at 100 commits", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ sha: `s${i}`, date: `2020-01-01T00:00:${String(99 - i).padStart(2, "0")}Z` }));
    const out = await citeDatesFromHistory(["https://x.example"], many, async () => "https://x.example");
    expect(out.get("https://x.example")).toMatchObject({ sha: "s99", exact: false });
  });
  it("tolerates unreadable commits and empty history", async () => {
    expect((await citeDatesFromHistory(["u"], [], async () => "u")).size).toBe(0);
    const out = await citeDatesFromHistory(["u"], commits, async (sha) => (sha === "c2" ? Promise.reject(new Error("x")) : "u"));
    expect(out.get("u")!.sha).toBe("c3");
  });
});

describe("GitHubClient", () => {
  const resolver = mockResolver();
  it("lists Markdown via the tree API and tracks rate limits", async () => {
    const t = mockTransport({
      "https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1": Response.json(
        { tree: [{ path: "README.md", type: "blob" }, { path: "docs", type: "tree" }, { path: "docs/a.md", type: "blob" }], truncated: false },
        { headers: { "x-ratelimit-remaining": "41", "x-ratelimit-reset": "1900000000" } },
      ),
    });
    const gh = new GitHubClient({ transport: t, resolver }, undefined);
    expect(await gh.listMarkdown({ owner: "o", repo: "r" })).toEqual({ ref: "HEAD", paths: ["README.md", "docs/a.md"], truncated: false });
    expect(gh.remaining).toBe(41);
    expect(gh.canAfford(1)).toBe(true);
    expect(gh.calls).toBe(1);
  });
  it("sends a server-side token only when configured", async () => {
    let auth: string | undefined;
    const t = mockTransport({
      "https://api.github.com/repos/o/r/commits*": (_u, init) => {
        auth = init.headers.authorization;
        return Response.json([{ sha: "a", commit: { author: { date: "2020-01-01T00:00:00Z" } } }, { sha: "b", commit: {} }]);
      },
    });
    const anon = new GitHubClient({ transport: t, resolver }, undefined);
    expect(await anon.fileCommits({ owner: "o", repo: "r" }, "HEAD", "README.md")).toEqual([{ sha: "a", date: "2020-01-01T00:00:00Z" }]);
    expect(auth).toBeUndefined();
    await new GitHubClient({ transport: t, resolver }, "test-token-not-real").fileCommits({ owner: "o", repo: "r" }, "main", "README.md");
    expect(auth).toBe("Bearer test-token-not-real");
  });
  it("raises RateLimitError and NotFoundError", async () => {
    const t = mockTransport({
      "https://api.github.com/repos/o/limited/*": new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" } }),
      "https://api.github.com/repos/o/err/*": 500,
    });
    const gh = new GitHubClient({ transport: t, resolver }, undefined);
    await expect(gh.listMarkdown({ owner: "o", repo: "limited" })).rejects.toBeInstanceOf(RateLimitError);
    expect(gh.canAfford(1)).toBe(false);
    await expect(gh.listMarkdown({ owner: "o", repo: "missing" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(gh.listMarkdown({ owner: "o", repo: "err" })).rejects.toThrow(/HTTP 500/);
  });
  it("fetchRaw reads raw.githubusercontent.com and maps 404 to null", async () => {
    const t = mockTransport({ "https://raw.githubusercontent.com/o/r/HEAD/docs/a%20b.md": new Response("# hi") });
    expect(await fetchRaw({ owner: "o", repo: "r" }, "HEAD", "docs/a b.md", { transport: t, resolver })).toBe("# hi");
    expect(await fetchRaw({ owner: "o", repo: "r" }, "HEAD", "nope.md", { transport: t, resolver })).toBeNull();
    const bad = mockTransport({ "https://raw.githubusercontent.com/*": 500 });
    await expect(fetchRaw({ owner: "o", repo: "r2" }, "HEAD", "x.md", { transport: bad, resolver })).rejects.toThrow();
  });
});
