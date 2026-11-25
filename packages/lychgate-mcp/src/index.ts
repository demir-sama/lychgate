import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

createServer()
  .connect(new StdioServerTransport())
  .catch((err) => {
    console.error("lychgate-mcp failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
