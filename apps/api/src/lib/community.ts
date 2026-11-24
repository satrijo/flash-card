// apps/api/src/lib/community.ts
// Data komunitas: DTO pesan, init tabel D1, verifikasi admin key.
// Dipakai routes/community.ts, routes/deck.ts, routes/backup.ts.

import type { D1Database } from "@cloudflare/workers-types";

export interface CommunityMessageDto {
  id: string;
  username: string;
  deviceId: string;
  content: string;
  flashcardRef?: {
    front: string;
    back: string;
    category: string;
  };
  timestamp: number;
}

export interface ActiveLearnerDto {
  username: string;
  activity: string;
  lastSeen: number;
}

let communityTablesInit = false;
export async function initCommunityD1(d1: D1Database): Promise<void> {
  if (communityTablesInit) return;
  try {
    await d1.batch([
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS community_messages (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          device_id TEXT NOT NULL,
          content TEXT NOT NULL,
          flashcard_ref TEXT,
          created_at INTEGER NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS community_presence (
          device_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          activity TEXT NOT NULL DEFAULT 'Online',
          last_seen INTEGER NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS user_handles (
          handle TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS user_cloud_backups (
          handle TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          backup_data TEXT NOT NULL,
          cards_count INTEGER NOT NULL DEFAULT 0,
          streak_count INTEGER NOT NULL DEFAULT 0,
          xp_count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )
      `),
      d1.prepare(`
        CREATE INDEX IF NOT EXISTS idx_comm_created ON community_messages(created_at DESC)
      `),
      d1.prepare(`
        CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON community_presence(last_seen DESC)
      `),
    ]);

    // Migrasi ringan jika kolom activity belum ada di database D1 existing
    try {
      await d1.prepare(`ALTER TABLE community_presence ADD COLUMN activity TEXT NOT NULL DEFAULT 'Online'`).run();
    } catch {
      // safe ignore jika kolom sudah ada
    }

    communityTablesInit = true;
  } catch (e) {
    console.warn("D1 init table error:", e);
  }
}

export function verifyAdminKey(providedKey?: string, envKey?: string): boolean {
  if (!providedKey) return false;
  const targetKey = envKey || "kata-admin-secret";
  return providedKey.trim() === targetKey.trim();
}
