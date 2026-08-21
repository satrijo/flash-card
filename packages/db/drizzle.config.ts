// packages/db/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./index.ts",
  out: "./migrations",
  dialect: "sqlite",
});
