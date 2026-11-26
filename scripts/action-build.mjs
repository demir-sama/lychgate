// Bundles the GitHub Action into one ESM file, committed so what runs is what was reviewed.
// The createRequire shim lets bundled CommonJS dependencies (undici) call require() on Node built-ins.
// Node 20 reads a .js file as ESM only when the nearest package.json says so, hence dist/package.json.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";

await build({
  entryPoints: ["action/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "import { createRequire as __lgCreateRequire } from \"node:module\";\nconst require = __lgCreateRequire(import.meta.url);",
  },
  outfile: "action/dist/index.js",
  legalComments: "none",
  minify: true,
});
mkdirSync("action/dist", { recursive: true });
writeFileSync("action/dist/package.json", `${JSON.stringify({ type: "module" })}\n`);
