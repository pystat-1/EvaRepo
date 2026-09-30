-- Eva relay (docs/adr/0002): a mailbox between Eva Desktop and evaluator
-- phones. Never the source of truth.

CREATE TABLE evaluators (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  passwordHash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updatedAt TEXT NOT NULL
);

CREATE TABLE sessions (
  tokenHash TEXT PRIMARY KEY,
  evaluatorId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX sessions_evaluator ON sessions (evaluatorId);

CREATE TABLE bundles (
  evaluatorId TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  json TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Append-only journal of validated days from phones, in arrival order.
CREATE TABLE submissions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  clientId TEXT NOT NULL UNIQUE,
  evaluatorId TEXT NOT NULL,
  groupId TEXT NOT NULL,
  dateISO TEXT NOT NULL,
  payload TEXT NOT NULL,
  receivedAt TEXT NOT NULL
);

-- What the desktop decided about each submission (shown on the phone).
CREATE TABLE results (
  clientId TEXT PRIMARY KEY,
  evaluatorId TEXT NOT NULL,
  outcome TEXT NOT NULL,
  message TEXT NOT NULL,
  decidedAt TEXT NOT NULL
);
CREATE INDEX results_evaluator ON results (evaluatorId);

-- Login attempts per email per 15-minute window (brute-force limit).
CREATE TABLE login_attempts (
  email TEXT NOT NULL,
  windowStart TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (email, windowStart)
);
