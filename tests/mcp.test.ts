import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "packages/lychgate-mcp/dist/index.js");

describe("lychgate-mcp over stdio (R4.3)", () => {
  let client: Client;

  beforeAll(async () => {
    const b = spawnSync("pnpm", ["-s", "mcp:build"], { cwd: root, encoding: "utf8" });
    expect(b.status, b.stderr).toBe(0);
    client = new Client({ name: "lychgate-smoke", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], cwd: root }));
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists the five tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_drift", "classify_url", "find_snapshot", "scan_links", "suggest_replacement"]);
  });

  it("classify_url on a metadata address is Sealed, with text then JSON blocks", async () => {
    const res = (await client.callTool({
      name: "classify_url",
      arguments: { url: "http://169.254.169.254/" },
    })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(res.content.length).toBeGreaterThanOrEqual(2);
    expect(res.content[0].text).toMatch(/sealed/i);
    const details = JSON.parse(res.content[1].text);
    expect(JSON.stringify(details).toLowerCase()).toContain("sealed");
  });
});
