// Backup policy for the desktop database: when to back up, what to name
// the file, and which old backups to delete. Pure, so it is unit-tested;
// the desktop app's Rust side does the actual file copying.
//
// File names: eva-YYYYMMDD-HHmmss-<reason>.db  (UTC time)
// Retention:  the newest 30, plus the oldest backup of each of the last
//             12 months, so a mistake noticed weeks later can still be
//             undone from a monthly copy.

export type BackupReason = "daily" | "manual" | "before-migrate" | "before-import" | "before-restore" | "before-update" | "before-delete";

export interface BackupFile {
  name: string;
  takenAt: Date;
  reason: string;
}

const NAME = /^eva-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([a-z-]+)\.db$/;

export function backupFileName(when: Date, reason: BackupReason): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `eva-${when.getUTCFullYear()}${p(when.getUTCMonth() + 1)}${p(when.getUTCDate())}-${p(when.getUTCHours())}${p(
    when.getUTCMinutes()
  )}${p(when.getUTCSeconds())}-${reason}.db`;
}

export function parseBackupName(name: string): BackupFile | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, reason] = m;
  const takenAt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(takenAt.getTime()) ? null : { name, takenAt, reason };
}

/** A daily backup is due when there is none, or the newest is 24 h old. */
export function isDailyBackupDue(files: string[], now: Date): boolean {
  const newest = files
    .map(parseBackupName)
    .filter((b): b is BackupFile => b !== null)
    .reduce<number>((max, b) => Math.max(max, b.takenAt.getTime()), 0);
  return newest === 0 || now.getTime() - newest >= 24 * 3600 * 1000;
}

/** Back up before migrating only if the file already holds data. */
export function shouldBackupBeforeMigrating(pendingCount: number, alreadyApplied: number): boolean {
  return pendingCount > 0 && alreadyApplied > 0;
}

/** Names of backups to delete. Files not matching the name pattern are never touched. */
export function backupsToDelete(files: string[], now: Date, keepNewest = 30, keepMonths = 12): string[] {
  const backups = files
    .map(parseBackupName)
    .filter((b): b is BackupFile => b !== null)
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
  const keep = new Set(backups.slice(0, keepNewest).map((b) => b.name));

  const oldestPerMonth = new Map<string, BackupFile>();
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (keepMonths - 1), 1);
  for (const b of backups) {
    if (b.takenAt.getTime() < cutoff) continue;
    const key = `${b.takenAt.getUTCFullYear()}-${b.takenAt.getUTCMonth()}`;
    const current = oldestPerMonth.get(key);
    if (!current || b.takenAt < current.takenAt) oldestPerMonth.set(key, b);
  }
  oldestPerMonth.forEach((b) => keep.add(b.name));
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}
