// Cloudflare Worker entry. Static files (the evaluator app) are served by
// Cloudflare's asset layer without running this code; only /api/* and
// /admin/* reach it (see wrangler.jsonc run_worker_first).
import { handle, type Env } from "./relay";

const worker = {
  fetch: (req: Request, env: Env) => handle(req, env),
};

export default worker;
