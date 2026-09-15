// Eva v3 — production data layer (Prisma + Postgres/Neon).
//
// Runs on Cloudflare Workers (via OpenNext), which has no TCP sockets and
// can't spawn Prisma's native query engine binary — so this uses Prisma's
// Neon driver adapter (GA as of Prisma 6.16) instead of a plain
// `new PrismaClient()`. The adapter talks to Neon over HTTP/WebSocket
// (via @neondatabase/serverless) rather than a raw Postgres connection,
// which is also why DATABASE_URL must be the Neon *pooled* ("-pooler")
// connection string, not the direct one.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

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
