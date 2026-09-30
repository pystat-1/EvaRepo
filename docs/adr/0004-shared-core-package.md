# ADR 0004: Business rules live in one shared package (@eva/core)

- **Status:** accepted, 2026-09-30
- **Context:** the same rules (score validation, the 7-day window, placement, rotation generation, attendance dates, conflict checks, Excel row rules) are needed on the desktop, on the phone, on the relay and, until switch-over, on the website.
- **Decision:** they live in `packages/core`: pure TypeScript, no database, no network, no UI, each module unit-tested. Apps import them as `@eva/core/...`. The website keeps its old import paths through one-line re-exports.
- **Consequences:** a rule changes in one place and is tested once; the relay and the desktop can never disagree about what a valid grade is.
