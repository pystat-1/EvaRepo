import { defineConfig } from "drizzle-kit";

// `npm run generate -w @eva/db` writes a new SQL migration into
// ./migrations after a schema change; bundle-migrations then embeds all of
// them into src/migrations.ts so the app ships them inside its code.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
