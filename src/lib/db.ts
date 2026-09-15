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

// Standard Next.js dev-hot-reload-safe singleton: without this, every hot
// reload in `next dev` would construct a new PrismaClient (and a new
// connection pool) on top of the last one.
export const prisma: PrismaClient = global.__evaPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__evaPrisma = prisma;
}
