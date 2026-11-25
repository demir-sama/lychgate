// Fake lychgate MCP server for hook tests: answers scan_links with canned results (no network).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake-lychgate", version: "0.0.0" });
server.tool("scan_links", { path: z.string() }, async ({ path }) => {
  if (path.includes("hang")) await new Promise(() => {});
  const results = [
    { url: "https://gone.example/a", cls: "tombstone", occurrences: [{ line: 3 }], snapshot: { url: "https://web.archive.org/web/2020/https://gone.example/a" } },
    { url: "https://soft.example/b", cls: "ghost", occurrences: [{ line: 5 }] },
    { url: "https://parked.example/c", cls: "zombie", occurrences: [{ line: 7 }], snapshot: { url: "https://web.archive.org/web/2019/https://parked.example/c" } },
    { url: "https://slow.example/d", cls: "restless", occurrences: [{ line: 9 }] },
  ];
  return { content: [{ type: "text", text: `scanned ${path}` }, { type: "text", text: JSON.stringify({ results }) }] };
});
await server.connect(new StdioServerTransport());
