// Cloudflare Worker entry (wrangler.jsonc "main"). It is OpenNext's own
// generated worker, unchanged, plus one thing: the Next.js server bundle is
// imported here at module scope, so it is evaluated when a Worker instance
// starts instead of inside the first request that instance serves.
//
// Why: OpenNext's worker does `await import("./server-functions/default/
// handler.mjs")` inside fetch(), so every fresh instance evaluated the whole
// Next.js server (100-500 ms of CPU) on a user's request. On the Workers
// Free plan a request may use 10 ms of CPU; instances that keep going over
// get their requests killed mid-response, which the browser shows as React
// error #412 ("Connection closed"). Startup work is not counted against the
// per-request CPU limit.
//
// The .open-next/ files only exist after `opennextjs-cloudflare build`, so
// this is plain JS: there is nothing for TypeScript to check here.
import openNextWorker from "./.open-next/worker.js";
import "./.open-next/server-functions/default/handler.mjs";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default openNextWorker;
