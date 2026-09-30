// One repository instance over the app's database, plus the query cache.
// Screens read with useQuery(...) and write with useMutation(...).
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { repo } from "@eva/db/repo/common";
import { exec } from "./db";

export const r = repo(exec);

// After ANY successful write, every cached read is refreshed, so all screens
// stay consistent. (A global MutationCache callback always runs; a default
// `onSuccess` would be replaced by a screen's own onSuccess.)
export const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({ onSuccess: () => void queryClient.invalidateQueries() }),
  defaultOptions: {
    // Local database: reads are fast and only change when this app writes.
    queries: { staleTime: Infinity, retry: 1, refetchOnWindowFocus: false },
  },
});

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
