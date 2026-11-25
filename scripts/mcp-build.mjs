// Bundles the MCP server into one ESM file. The createRequire shim lets bundled
// CommonJS dependencies (undici) call require() on Node built-ins.
import { build } from "esbuild";

await build({
  entryPoints: ["packages/lychgate-mcp/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __lgCreateRequire } from \"node:module\";\nconst require = __lgCreateRequire(import.meta.url);",
  },
  outfile: "packages/lychgate-mcp/dist/index.js",
});
