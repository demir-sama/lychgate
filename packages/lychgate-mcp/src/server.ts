import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { classifyUrlTool, ClassifyUrlInput, findSnapshotTool, FindSnapshotInput, checkDriftTool, CheckDriftInput, scanLinksTool, ScanLinksInput, suggestReplacementTool, SuggestReplacementInput, type ToolDeps } from "./tools";

export function createServer(deps: ToolDeps = {}): McpServer {
  const server = new McpServer({ name: "lychgate", version: pkg.version });
  // The SDK validates against these zod shapes; the handlers validate again so direct callers
  // (tests, other transports) also get a readable error result instead of a throw (R2.5).
  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "classify_url",
    {
      description: "Classify one URL as living, tombstone, ghost, drifted, zombie, restless or sealed, with confidence, reasons and the Wayback snapshot closest before citeDate (YYYY-MM-DD).",
      inputSchema: { url: ClassifyUrlInput.shape.url, citeDate: ClassifyUrlInput.shape.citeDate },
      annotations: readOnly,
    },
    (args) => classifyUrlTool(args, deps),
  );

  server.registerTool(
    "find_snapshot",
    {
      description: "Find the Wayback Machine snapshot of a URL: the latest 200 capture on or before `before` (YYYY-MM-DD), or the latest overall.",
      inputSchema: { url: FindSnapshotInput.shape.url, before: FindSnapshotInput.shape.before },
      annotations: readOnly,
    },
    (args) => findSnapshotTool(args, deps),
  );

  server.registerTool(
    "check_drift",
    {
      description: "Compare the live page with its Wayback snapshot from citeDate (YYYY-MM-DD) and report text similarity and whether it fell below the Drifted threshold.",
      inputSchema: { url: CheckDriftInput.shape.url, citeDate: CheckDriftInput.shape.citeDate },
      annotations: readOnly,
    },
    (args) => checkDriftTool(args, deps),
  );

  server.registerTool(
    "scan_links",
    {
      description: "Scan links and return a health summary plus the non-living results, worst first. Give exactly one of: path (Markdown file inside the working directory), markdown (text), url (a page) or repo (public GitHub owner/repo). Optional citeDate (YYYY-MM-DD). Capped at 300 links and 120 s. Read-only.",
      inputSchema: ScanLinksInput.shape,
      annotations: readOnly,
    },
    (args) => scanLinksTool(args, deps),
  );

  server.registerTool(
    "suggest_replacement",
    {
      description: "Suggest one live replacement for a moved page: a renamed GitHub repo, a same-domain redirect, or the closest page in the site's sitemap. Only a URL that checks out as living is returned. Read-only; nothing is changed.",
      inputSchema: { url: SuggestReplacementInput.shape.url },
      annotations: readOnly,
    },
    (args) => suggestReplacementTool(args, deps),
  );

  return server;
}
