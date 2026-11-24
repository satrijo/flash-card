// apps/api/src/lib/env.ts
// Environment bindings Cloudflare Worker + akses D1.
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export type Bindings = {
  DB: D1Database;
  flashcard_db: D1Database;
  BACKUP_BUCKET?: R2Bucket;
  MCP_TOKEN?: string;
  ADMIN_KEY?: string;
};

export const getD1 = (c: { env: Bindings }) => c.env.flashcard_db ?? c.env.DB;
