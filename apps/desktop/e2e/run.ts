// npm run e2e -w @eva/desktop [-- flow|perf|backup]   (all when nothing is given)
// Builds nothing itself: the phone app must be built (npm run build -w @eva/evaluator).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, log, startVite, stopServers } from "./harness";
import { flow } from "./flow";
import { perf } from "./perf";
import { backup } from "./backup";

const TESTS = { flow, perf, backup };
const which = process.argv.slice(2).filter((a): a is keyof typeof TESTS => a in TESTS);
const run = which.length ? which : (Object.keys(TESTS) as Array<keyof typeof TESTS>);
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
      await TESTS[name](browser, out).catch(async (e) => {
        // keep what each open page showed, for the report
        const shots = process.env.EVA_E2E_SHOTS ?? out;
        let n = 0;
        for (const ctx of browser.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: path.join(shots, `fail-${name}-${++n}.png`) }).catch(() => undefined);
        console.error(`screenshots: ${shots}`);
        throw e;
      });
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
