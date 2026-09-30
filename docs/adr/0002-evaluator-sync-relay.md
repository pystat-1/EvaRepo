# ADR 0002: Evaluator phones sync through a tiny free relay (Cloudflare Worker + D1)

- **Status:** accepted, 2026-09-30
- **Context:** evaluators grade on phones in different hospitals; their grades must reach the admin's computer, which is not reachable from the internet.
- **Decision:** a small Cloudflare Worker with a D1 (SQLite) database acts as a **mailbox**: the desktop publishes course bundles (rosters, schedule, rubric) for each evaluator; phones post submissions into an append-only journal; the desktop pulls, applies and acknowledges them. No Next.js, no Prisma: plain handlers with SQL, ~1–3 ms CPU per request, inside the free plan.
- **Alternatives:** Google Apps Script/Sheets relay (slower, weak auth, poor conflict handling); same-Wi-Fi-only sync (evaluators rarely share the admin's network).
- **Consequences:** the relay is never the source of truth; losing it loses nothing the desktop has pulled. Every submission carries a client-generated ID so re-sending is harmless (idempotent). The desktop applies submissions in relay order and keeps the existing conflict and 7-day rules.
