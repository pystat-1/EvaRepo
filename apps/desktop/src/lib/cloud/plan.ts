// What one online-backup round does, decided from the two lists of names
// (pure, tested): upload what is only on this computer, thin the online
// copies with the usual policy (the last 30, plus one a month for a year),
// and keep only the newest few on this computer — never removing a local
// backup that is not safely online.
import { backupsToDelete } from "@eva/db/backup";

export const REMOTE_SUFFIX = ".evab";
export const KEEP_LOCAL = 3;

export interface CloudPlan {
  upload: string[]; // local names
  deleteRemote: string[]; // remote names (with the suffix)
  deleteLocal: string[]; // local names
}

export function planCloud(local: string[], remote: string[], now: Date, keepLocal = KEEP_LOCAL): CloudPlan {
  const online = new Set(remote.filter((r) => r.endsWith(REMOTE_SUFFIX)).map((r) => r.slice(0, -REMOTE_SUFFIX.length)));
  const upload = local.filter((n) => !online.has(n)).sort();
  const afterUpload = new Set([...online, ...upload]);
  const deleteRemote = backupsToDelete([...afterUpload], now).map((n) => n + REMOTE_SUFFIX);
  const newestFirst = [...local].sort().reverse();
  // Only what is ALREADY online may go (after uploading, the round asks again).
  const deleteLocal = newestFirst.slice(keepLocal).filter((n) => online.has(n));
  return { upload, deleteRemote, deleteLocal };
}
