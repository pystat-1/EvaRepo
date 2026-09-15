// Eva v3 — production data layer (Prisma + Postgres/Neon).
//
// Runs on Cloudflare Workers (via OpenNext), which has no TCP sockets and
// can't spawn Prisma's native query engine binary — so this uses Prisma's
// Neon driver adapter (GA as of Prisma 6.16) instead of a plain
// `new PrismaClient()`. That adapter is built on @neondatabase/serverless,
// which is why DATABASE_URL must be the Neon *pooled* ("-pooler")
// connection string, not the direct one.
//
// poolQueryViaFetch=true makes every query go over plain HTTP fetch
// instead of opening a WebSocket. This is required, not just faster: a
// WebSocket-backed Pool "can't outlive a single request" in Workers (Neon
// and Cloudflare both document this), but this module's client is a
// singleton reused across requests within the same Worker isolate — with
// WebSocket mode, a second request reusing the isolate would try to reuse
// a socket from a prior, already-finished request and Workers kills that
// as "I/O on behalf of a different request", crashing every request past
// the first with a 500. Fetch-mode queries are stateless, so there's no
// connection lifetime to violate.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.poolQueryViaFetch = true;

declare global {
  // eslint-disable-next-line no-var
  var __evaPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

function getPrismaClient(): PrismaClient {
  if (!global.__evaPrisma) {
    global.__evaPrisma = createPrismaClient();
  }
  return global.__evaPrisma;
}

// Lazy singleton, proxied so `createPrismaClient()` only runs on first
// actual use — not at module load. Next's build-time "collect page data"
// step imports every route module (including this one, transitively) to
// inspect its exports, with no real DATABASE_URL in that build
// environment; a client constructed eagerly at module scope would throw
// there. This also keeps the standard Next.js dev-hot-reload-safe
// singleton behavior: without it, every hot reload in `next dev` would
// construct a new PrismaClient (and a new connection pool) on top of the
// last one.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrismaClient(), prop, receiver);
  },
});
