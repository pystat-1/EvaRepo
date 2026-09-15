import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every route in this app is dynamic (server-rendered per request — see
// next build output, no ISR/static revalidation anywhere), so the default
// config is enough; no R2 incremental-cache override needed.
export default defineCloudflareConfig();
