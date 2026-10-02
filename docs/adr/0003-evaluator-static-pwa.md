# ADR 0003: Evaluator app is a separate static PWA

- **Status:** accepted, 2026-09-30
- **Context:** evaluators use phones; the owner wants the evaluator app to stay a separate, simple, installable link.
- **Decision:** a Vite + React **installable PWA**, served as **static files** from Cloudflare Pages (static files use no Worker CPU). Data lives on the phone in IndexedDB (Dexie): the course bundle, drafts and an outbox. It talks only to the relay (ADR 0002).
- **Consequences:** it works fully offline once the bundle is downloaded; it keeps the current flows (today's group from the schedule or a picked group, attendance, daily note, day-grades table, validation).
