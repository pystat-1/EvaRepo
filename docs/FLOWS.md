# Eva: key flows

Diagrams for `docs/DESKTOP_APP_PLAN.md` §6. They render on GitHub (Mermaid).
"Desktop" is the admin's Eva Desktop app, "relay" the sync mailbox, and
"phone" the evaluator app.

## 1. Import students from Excel

```mermaid
flowchart TD
  A[Admin downloads template<br/>قالب الطلاب] --> B[Fills it in Excel]
  B --> C[Chooses the file in Eva]
  C --> D{File has the template<br/>headers?}
  D -- no --> E[Show: missing columns] --> C
  D -- yes --> F[Check every row<br/>@eva/core importRows]
  F --> G[Preview: valid count,<br/>per-group counts, row errors]
  G --> H{Admin confirms?}
  H -- no --> C
  H -- yes --> I[Backup snapshot]
  I --> J[Write in one transaction:<br/>new by university no.,<br/>update existing]
  J --> K[Optional: remove sample students,<br/>deactivate students not in file]
  K --> L[Done: counts shown]
```

## 2. Publish the course to evaluators

```mermaid
flowchart TD
  A[Admin: publish / update course] --> B[Check schedule conflicts]
  B --> C{Blocking conflicts?}
  C -- yes --> D[Show them; stop]
  C -- no --> E[Build one bundle per evaluator:<br/>their hospitals' groups, rosters,<br/>schedule, rubric, bundleVersion]
  E --> F{Online?}
  F -- no --> G[Queue; retry when online]
  F -- yes --> H[Upload bundles to relay]
  H --> I[Phones fetch the new bundle<br/>on next open]
```

## 3. Evaluator grading on the phone

```mermaid
stateDiagram-v2
  [*] --> Free
  Free --> Draft: open student / table row
  Draft --> Draft: autosave on every change
  Draft --> Saved: save
  Saved --> Draft: edit (day not validated)
  Saved --> Validated: اعتماد the day
  Validated --> Queued: add to outbox
  Queued --> Sent: relay reachable
  Sent --> Acknowledged: desktop applied it
  Sent --> Conflict: another evaluator graded the same student-day
  Conflict --> Acknowledged: admin chooses one grade
  Acknowledged --> [*]
```

## 4. Desktop pulls grades

```mermaid
sequenceDiagram
  participant D as Desktop (SQLite)
  participant R as Relay (journal)
  loop every few minutes while online
    D->>R: GET entries after my last position
    R-->>D: submissions in relay order (id, evaluator, payload)
    D->>D: for each: already applied? skip (idempotent)
    D->>D: rules: scope, 7-day window, locked? conflict?
    D->>D: apply in one transaction, or record the conflict
    D->>R: ACK up to this position
  end
```

## 5. Backup and restore

```mermaid
flowchart TD
  A[App start] --> B[integrity_check on eva.db]
  B --> C{OK?}
  C -- no --> D[Offer: restore latest good backup]
  C -- yes --> E{Last backup older than 24 h?}
  E -- yes --> F[Backup now]
  E -- no --> G[Continue]
  F --> G
  H[Before update / migration / import] --> F
  G --> I[Keep newest 30 backups;<br/>optional copy to USB / Drive]
```
