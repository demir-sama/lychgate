import { appendFileSync } from "node:fs";
import { run } from "./run";

// The only writes this action makes: GitHub's two files, and stdout.
async function main(): Promise<number> {
  try {
    const r = await run(process.env);
    for (const line of r.stdout) console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.summary);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `health=${r.outputs.health}\ndead=${r.outputs.dead}\n`);
    return r.exitCode;
  } catch (err) {
    console.log(`Lychgate: unexpected failure: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

// Open sockets from the checks must not keep the runner step alive.
process.exit(await main());
