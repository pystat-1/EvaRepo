// npm run e2e -w @eva/desktop [-- flow|perf]   (both when nothing is given)
// Builds nothing itself: the phone app must be built (npm run build -w @eva/evaluator).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, log, startVite, stopServers } from "./harness";
import { flow } from "./flow";
import { perf } from "./perf";

const which = process.argv.slice(2).filter((a) => a === "flow" || a === "perf");
const run = which.length ? which : ["flow", "perf"];
const out = fs.mkdtempSync(path.join(os.tmpdir(), "eva-e2e-"));

let failed = false;
try {
  await startVite("desktop", 1420);
  if (run.includes("flow")) await startVite("evaluator", 1430, true);
  const browser = await launch();
  try {
    for (const name of run) {
      log(`\n── ${name} ──`);
      const t0 = Date.now();
      await (name === "flow" ? flow : perf)(browser, out);
      log(`── ${name} passed in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } finally {
    await browser.close();
  }
} catch (e) {
  failed = true;
  console.error(`\n✗ ${(e as Error).message}`);
} finally {
  stopServers();
  try {
    fs.rmSync(out, { recursive: true, force: true });
  } catch {
    /* a test database still open after a failure: the temp folder is cleaned by the OS */
  }
}
process.exit(failed ? 1 : 0);
