// Eva v3 — production data layer (Prisma + Postgres).
//
// TODO(verify-on-deploy): This file, and every file under src/lib/models/
// plus src/lib/audit.ts and src/lib/auth.ts, were converted from the old
// node:sqlite raw-SQL layer to a real Prisma client by hand, in a sandbox
// whose outbound network blocks binaries.prisma.sh — the host Prisma's CLI
// downloads its query-engine/schema-engine binaries from. `npm install
// prisma @prisma/client` DOES succeed here (confirmed — the npm registry
// itself is reachable), but `npx prisma generate` fails with a 403 from
// binaries.prisma.sh even with PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1, so
// `@prisma/client` in this sandbox only ever contains its un-generated
// stub (PrismaClient typed as `any`, no per-model types). That means
// `npx tsc --noEmit` passing in this sandbox is NOT proof this code is
// correct against the real generated client — it only proves there are no
// *other* type errors, because every `prisma.<model>.<method>()` call
// currently type-checks as `any`. Vercel's build runs `npm install`, which
// runs the `postinstall: "prisma generate"` script added to package.json,
// with normal network access — that is what will actually generate the
// real client and produce real type errors, if any remain. Re-run
// `npx tsc --noEmit` right after the first real `prisma generate` (locally
// or in a Vercel build log) and fix anything it reports before trusting
// this layer in production.
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __evaPrisma: PrismaClient | undefined;
}

// Standard Next.js dev-hot-reload-safe singleton: without this, every hot
// reload in `next dev` would construct a new PrismaClient (and a new
// connection pool) on top of the last one.
export const prisma: PrismaClient = global.__evaPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__evaPrisma = prisma;
}
