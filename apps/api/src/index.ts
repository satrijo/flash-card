// apps/api/src/index.ts
import { Hono } from "hono";
import { z } from "zod";
import {
  and,
  asc,
  count,
  desc,
  eq,
  like,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { cards } from "@flashcard/db";
import { cors } from "hono/cors";
import {
  Rating,
  createEmptyCard,
  fsrsEngine,
  type FSRSCard,
} from "@flashcard/shared";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

type Bindings = {
  DB: D1Database;
  flashcard_db: D1Database;
  BACKUP_BUCKET?: R2Bucket;
  MCP_TOKEN?: string;
  ADMIN_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS for both /api/* and /mcp (remote AI callers)
app.use("/*", cors());

// ===========================================================================
// DECK API — read-only, top-down download untuk web/PWA.
// Server hanyalah perpustakaan kartu bersama; progress belajar tidak pernah
// dikirim balik ke sini (murni IndexedDB per device).
// ===========================================================================

const getD1 = (c: { env: Bindings }) => c.env.flashcard_db ?? c.env.DB;

// FNV-1a 32-bit atas seluruh isi tabel cards (di-sort by id supaya stabil).
// Dipakai client sebagai version-check: sama = skip download.
// Diekspor supaya bisa diuji langsung (deck-version.test.ts); T3 memindahkan
// fungsi ini ke src/lib/deck-version.ts tanpa mengubah perilaku.
export function deckVersionFromRows(
  rows: { id: string; front: string; back: string; category: string }[],
): string {
  let hash = 0x811c9dc5;
  const step = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const r of rows) {
    step(`${r.id}\u0000${r.front}\u0000${r.back}\u0000${r.category}`);
    step("\u0001"); // pemisah antar kartu
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// COMMUNITY CHAT STATE & WEBSOCKET BROADCAST
// ---------------------------------------------------------------------------

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

const recentMessages: CommunityMessageDto[] = [
  {
    id: "welcome-msg-1",
    username: "KataBot",
    deviceId: "system-bot",
    content: "Selamat datang di Komunitas Belajar Kata! 👋 Ruang belajar bersama, berbagi kosakata, dan ngobrol live antar pembelajar.",
    timestamp: Date.now() - 600000,
  },
];

const connectedSockets = new Set<WebSocket>();

function broadcastCommunity(data: Record<string, unknown>) {
  const payload = JSON.stringify(data);
  for (const ws of connectedSockets) {
    try {
      ws.send(payload);
    } catch {
      connectedSockets.delete(ws);
    }
  }
}

type CloudflareWebSocket = WebSocket & { accept: () => void };

interface WebSocketPairConstructor {
  new (): { 0: CloudflareWebSocket; 1: CloudflareWebSocket };
}

const WSPair = (globalThis as unknown as { WebSocketPair?: WebSocketPairConstructor }).WebSocketPair;

// WebSocket endpoint untuk Real-time Multi-User Chat
app.get("/ws/community", async (c) => {
  const upgradeHeader = c.req.header("Upgrade") || c.req.header("upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  if (!WSPair) {
    return c.text("WebSocket not available in this environment", 501);
  }

  const pair = new WSPair();
  const client = pair[0];
  const server = pair[1];

  server.accept();
  connectedSockets.add(server);

  // Kirim histori pesan dan info jumlah online ke client yang baru terhubung
  try {
    server.send(
      JSON.stringify({
        type: "history",
        messages: recentMessages.slice(-50),
        onlineCount: connectedSockets.size,
      })
    );
  } catch {
    // ignore
  }

  broadcastCommunity({
    type: "presence",
    onlineCount: connectedSockets.size,
  });

  server.addEventListener("message", (event) => {
    try {
      const dataStr = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      const data = JSON.parse(dataStr);
      if (data.type === "chat" && typeof data.content === "string") {
        const cleanContent = data.content.trim().slice(0, 500);
        if (!cleanContent) return;

        const newMsg: CommunityMessageDto = {
          id: String(data.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          username: String(data.username || "Pembelajar").slice(0, 24),
          deviceId: String(data.deviceId || "unknown").slice(0, 64),
          content: cleanContent,
          flashcardRef: data.flashcardRef,
          timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
        };

        if (!recentMessages.some((m) => m.id === newMsg.id)) {
          recentMessages.push(newMsg);
          if (recentMessages.length > 200) {
            recentMessages.shift();
          }
        }

        broadcastCommunity({
          type: "new_message",
          message: newMsg,
        });
      }
    } catch {
      // ignore malformed message
    }
  });

  const handleClose = () => {
    connectedSockets.delete(server);
    broadcastCommunity({
      type: "presence",
      onlineCount: connectedSockets.size,
    });
  };

  server.addEventListener("close", handleClose);
  server.addEventListener("error", handleClose);

  return new Response(null, {
    status: 101,
    webSocket: client,
  } as ResponseInit & { webSocket: CloudflareWebSocket });
});

let communityTablesInit = false;
async function initCommunityD1(d1: D1Database): Promise<void> {
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

function normalizeUserHandle(input: string): string {
  let clean = String(input || "").trim().toLowerCase();
  if (!clean.startsWith("kata-")) {
    clean = `kata-${clean}`;
  }
  clean = clean.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
  return clean.slice(0, 30);
}

const RESERVED_HANDLES = new Set([
  "kata-admin",
  "kata-administrator",
  "kata-operator",
  "kata-op",
  "kata-mod",
  "kata-moderator",
  "kata-staff",
  "kata-system",
  "kata-support",
  "kata-official",
  "kata-katabot",
  "kata-bot",
  "kata-root",
  "kata-superuser",
  "kata-ai",
  "kata-tutor",
  "kata-help",
  "kata-developer",
  "kata-owner",
  "kata-founder",
  "kata-security",
]);

function isReservedHandle(handle: string): boolean {
  const norm = handle.toLowerCase().trim();
  if (RESERVED_HANDLES.has(norm)) return true;
  const raw = norm.replace(/^kata-/, "");
  const reservedWords = [
    "admin",
    "administrator",
    "operator",
    "moderator",
    "staff",
    "system",
    "support",
    "official",
    "katabot",
    "superuser",
    "root",
    "security",
  ];
  return reservedWords.some(
    (word) => raw === word || raw.startsWith(`${word}-`) || raw.endsWith(`-${word}`)
  );
}

function verifyAdminKey(providedKey?: string, envKey?: string): boolean {
  if (!providedKey) return false;
  const targetKey = envKey || "kata-admin-secret";
  return providedKey.trim() === targetKey.trim();
}

export interface ActiveLearnerDto {
  username: string;
  activity: string;
  lastSeen: number;
}

// In-Memory cache for deck version to prevent reading 2,500 rows on every sync check
let cachedDeckVersionData: { version: string; count: number; expiresAt: number } | null = null;

export function invalidateDeckVersionCache() {
  cachedDeckVersionData = null;
}

const routes = app
  .get("/api/hello", async (c) => {
    return c.json({ message: "Hello from Cloudflare D1!" });
  })
  .get("/api/community/messages", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const since = Number(c.req.query("since") || "0");
    const now = Date.now();
    const activeCutoff = now - 60_000;

    // Jika ada param 'since', hanya ambil pesan baru (hemat row read D1)
    const query =
      since > 0
        ? d1
            .prepare(
              `SELECT id, username, device_id as deviceId, content, flashcard_ref as flashcardRef, created_at as timestamp
               FROM community_messages
               WHERE created_at > ?
               ORDER BY created_at ASC
               LIMIT 40`
            )
            .bind(since)
        : d1.prepare(
            `SELECT id, username, device_id as deviceId, content, flashcard_ref as flashcardRef, created_at as timestamp
             FROM community_messages
             ORDER BY created_at DESC
             LIMIT 30`
          );

    const [rows, presenceRes] = await Promise.all([
      query.all<{
        id: string;
        username: string;
        deviceId: string;
        content: string;
        flashcardRef: string | null;
        timestamp: number;
      }>(),
      d1
        .prepare(
          `SELECT count(device_id) as count
           FROM community_presence
           WHERE last_seen > ?`
        )
        .bind(activeCutoff)
        .first<{ count: number }>(),
    ]);

    const resultsList =
      since > 0 ? rows.results || [] : (rows.results || []).reverse();
    const formatted: CommunityMessageDto[] = resultsList.map((r) => ({
      id: r.id,
      username: r.username,
      deviceId: r.deviceId,
      content: r.content,
      flashcardRef: r.flashcardRef ? JSON.parse(r.flashcardRef) : undefined,
      timestamp: r.timestamp,
    }));

    return c.json({
      messages: formatted,
      onlineCount: Math.max(1, presenceRes?.count ?? 1),
    });
  })
  .post("/api/community/messages", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const cleanContent = String(body.content || "").trim().slice(0, 500);
    if (!cleanContent) {
      return c.json({ error: "Pesan tidak boleh kosong" }, 400);
    }

    const now = Date.now();
    const newMsg: CommunityMessageDto = {
      id: String(body.id || `msg-${now}-${Math.random().toString(36).slice(2, 8)}`),
      username: String(body.username || "Pembelajar").slice(0, 24),
      deviceId: String(body.deviceId || "unknown").slice(0, 64),
      content: cleanContent,
      flashcardRef: body.flashcardRef as CommunityMessageDto["flashcardRef"],
      timestamp: typeof body.timestamp === "number" ? body.timestamp : now,
    };
    const activity = String(body.activity || "Di Komunitas").slice(0, 50);

    await d1.batch([
      d1.prepare(`
        INSERT OR REPLACE INTO community_messages (id, username, device_id, content, flashcard_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        newMsg.id,
        newMsg.username,
        newMsg.deviceId,
        newMsg.content,
        newMsg.flashcardRef ? JSON.stringify(newMsg.flashcardRef) : null,
        newMsg.timestamp,
      ),
      d1.prepare(`
        INSERT OR REPLACE INTO community_presence (device_id, username, activity, last_seen)
        VALUES (?, ?, ?, ?)
      `).bind(newMsg.deviceId, newMsg.username, activity, now),
      d1.prepare(`
        DELETE FROM community_messages
        WHERE created_at < ?
      `).bind(now - 24 * 60 * 60 * 1000),
    ]);

    broadcastCommunity({
      type: "new_message",
      message: newMsg,
    });

    return c.json({ success: true, message: newMsg });
  })
  .post("/api/community/heartbeat", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId || "").slice(0, 64);
    const username = String(body.username || "Pembelajar").slice(0, 24);
    const activity = String(body.activity || "Online").slice(0, 50);
    if (!deviceId) {
      return c.json({ success: false, onlineCount: 1, activeLearners: [] });
    }

    const now = Date.now();
    const activeCutoff = now - 45_000;

    // Simpan presence dan bersihkan record basi (> 60 detik)
    await d1.batch([
      d1.prepare(`
        INSERT OR REPLACE INTO community_presence (device_id, username, activity, last_seen)
        VALUES (?, ?, ?, ?)
      `).bind(deviceId, username, activity, now),
      d1.prepare(`
        DELETE FROM community_presence
        WHERE last_seen < ?
      `).bind(now - 60_000),
    ]);

    const learnersRes = await d1.prepare(`
      SELECT username, COALESCE(activity, 'Online') as activity, max(last_seen) as lastSeen
      FROM community_presence
      WHERE last_seen > ?
      GROUP BY username
      ORDER BY lastSeen DESC
      LIMIT 50
    `).bind(activeCutoff).all<{ username: string; activity: string; lastSeen: number }>();

    const activeLearners = learnersRes.results || [];
    const onlineCount = Math.max(1, activeLearners.length);

    return c.json({
      success: true,
      onlineCount,
      activeLearners,
    });
  })
  .get("/api/deck/version", async (c) => {
    const now = Date.now();
    if (cachedDeckVersionData && now < cachedDeckVersionData.expiresAt) {
      c.header("Cache-Control", "public, max-age=300, s-maxage=1800");
      return c.json({
        version: cachedDeckVersionData.version,
        count: cachedDeckVersionData.count,
      });
    }

    const db = drizzle(getD1(c));
    const rows = await db
      .select({
        id: cards.id,
        front: cards.front,
        back: cards.back,
        category: cards.category,
      })
      .from(cards)
      .orderBy(asc(cards.id))
      .all();

    const version = deckVersionFromRows(rows);
    cachedDeckVersionData = {
      version,
      count: rows.length,
      expiresAt: now + 300_000, // Cache di Worker memori selama 5 menit
    };

    c.header("Cache-Control", "public, max-age=300, s-maxage=1800");
    return c.json({
      version,
      count: rows.length,
    });
  })
  .get("/api/deck/cards", async (c) => {
    const offsetRaw = Number(c.req.query("offset") ?? "0");
    const limitRaw = Number(c.req.query("limit") ?? "100");
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 200)
      : 100;

    const db = drizzle(getD1(c));
    const rows = await db
      .select()
      .from(cards)
      .orderBy(asc(cards.id))
      .limit(limit)
      .offset(offset)
      .all();

    c.header("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return c.json({ cards: rows, hasMore: rows.length === limit });
  })
  .get("/api/user/check-handle", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const rawHandle = c.req.query("handle") || "";
    const deviceId = c.req.query("deviceId") || "";
    const handle = normalizeUserHandle(rawHandle);

    if (handle.length < 6 || !/^kata-[a-z0-9_-]{2,24}$/.test(handle)) {
      return c.json({
        available: false,
        ownedByMe: false,
        handle,
        error: "ID harus berformat kata-<nama> (huruf, angka, strip, 3-24 karakter)",
      });
    }

    if (isReservedHandle(handle)) {
      const adminKey = c.req.query("adminKey") || "";
      const isValid = verifyAdminKey(adminKey, c.env.ADMIN_KEY);
      if (!isValid) {
        return c.json({
          available: false,
          ownedByMe: false,
          handle,
          requiresAdminKey: true,
          error: `ID "${handle}" dilindungi (khusus admin/operator). Masukkan Admin Secret Key untuk mengklaim.`,
        });
      }
    }

    const row = await d1
      .prepare(`SELECT handle, device_id FROM user_handles WHERE handle = ?`)
      .bind(handle)
      .first<{ handle: string; device_id: string }>();

    if (!row) {
      return c.json({ available: true, ownedByMe: false, handle });
    }

    const ownedByMe = row.device_id === deviceId;
    return c.json({
      available: ownedByMe,
      ownedByMe,
      handle,
      error: ownedByMe ? undefined : `ID ${handle} sudah dipakai pengguna lain`,
    });
  })
  .post("/api/user/claim-handle", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawHandle = String(body.handle || "");
    const deviceId = String(body.deviceId || "").slice(0, 64);
    const adminKey = String(body.adminKey || "").trim();
    const handle = normalizeUserHandle(rawHandle);

    if (!deviceId) {
      return c.json({ error: "Device ID wajib disertakan" }, 400);
    }
    if (handle.length < 6 || !/^kata-[a-z0-9_-]{2,24}$/.test(handle)) {
      return c.json(
        {
          error:
            "Format ID tidak valid. Gunakan format kata-<nama> (3-24 karakter alphanumeric)",
        },
        400
      );
    }

    if (isReservedHandle(handle)) {
      const isValid = verifyAdminKey(adminKey, c.env.ADMIN_KEY);
      if (!isValid) {
        return c.json(
          {
            error: `ID "${handle}" dilindungi. Masukkan Admin Secret Key yang benar.`,
            requiresAdminKey: true,
          },
          403
        );
      }
    }

    const existing = await d1
      .prepare(`SELECT handle, device_id FROM user_handles WHERE handle = ?`)
      .bind(handle)
      .first<{ handle: string; device_id: string }>();

    const now = Date.now();
    if (existing && existing.device_id !== deviceId && !verifyAdminKey(adminKey, c.env.ADMIN_KEY)) {
      return c.json(
        {
          error: `ID ${handle} sudah dimiliki pengguna lain. Silakan pilih ID lain.`,
        },
        409
      );
    }

    await d1.batch([
      d1.prepare(`
        INSERT OR REPLACE INTO user_handles (handle, device_id, created_at, updated_at)
        VALUES (?, ?, COALESCE((SELECT created_at FROM user_handles WHERE handle = ?), ?), ?)
      `).bind(handle, deviceId, handle, now, now),
      d1.prepare(`
        UPDATE community_presence
        SET username = ?
        WHERE device_id = ?
      `).bind(handle, deviceId),
    ]);

    return c.json({ success: true, handle });
  })
  .delete("/api/community/messages/:id", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const adminKey = c.req.header("X-Admin-Key") || c.req.query("adminKey") || "";
    if (!verifyAdminKey(adminKey, c.env.ADMIN_KEY)) {
      return c.json({ error: "Unauthorized: Admin key diperlukan" }, 403);
    }

    const id = c.req.param("id");
    await d1.prepare(`DELETE FROM community_messages WHERE id = ?`).bind(id).run();
    return c.json({ success: true, deletedId: id });
  })
  .post("/api/backup/cloud", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawHandle = String(body.handle || "");
    const deviceId = String(body.deviceId || "").slice(0, 64);
    const backupData = body.backupData;
    const stats = (body.stats || {}) as Record<string, number>;

    const handle = normalizeUserHandle(rawHandle);
    if (!handle || !backupData) {
      return c.json({ error: "Data cadangan atau ID tidak valid" }, 400);
    }

    const now = Date.now();
    const backupJson =
      typeof backupData === "string" ? backupData : JSON.stringify(backupData);
    const cardsCount = Number(stats.cardsCount ?? 0);
    const streakCount = Number(stats.streakCount ?? 0);
    const xpCount = Number(stats.xpCount ?? 0);

    // 1. Simpan ke Cloudflare R2 jika bucket terkonfigurasi
    let r2Saved = false;
    if (c.env.BACKUP_BUCKET) {
      try {
        await c.env.BACKUP_BUCKET.put(`backups/${handle}.json`, backupJson, {
          customMetadata: {
            handle,
            deviceId,
            updatedAt: String(now),
            cardsCount: String(cardsCount),
          },
        });
        r2Saved = true;
      } catch (e) {
        console.warn("R2 backup put error, falling back to D1:", e);
      }
    }

    // 2. Simpan juga ke D1 database (dengan penanganan error dan pencegahan statement overload)
    try {
      // Jika sudah tersimpan di R2, hindari memaksakan penulisan ratusan KB JSON utuh ke D1 SQL row
      const d1BackupData = r2Saved ? "r2" : backupJson;
      await d1
        .prepare(
          `INSERT OR REPLACE INTO user_cloud_backups (handle, device_id, backup_data, cards_count, streak_count, xp_count, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(handle, deviceId, d1BackupData, cardsCount, streakCount, xpCount, now)
        .run();
    } catch (e) {
      console.warn("D1 backup metadata save error:", e);
      // Jika R2 gagal DAN D1 juga gagal, baru kembalikan error
      if (!r2Saved) {
        return c.json(
          { error: "Gagal menyimpan cadangan ke cloud maupun database D1" },
          500
        );
      }
    }

    return c.json({
      success: true,
      handle,
      backupAt: now,
      cardsCount,
      streakCount,
      xpCount,
      storage: r2Saved ? "r2" : "d1",
    });
  })
  .get("/api/backup/cloud", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const rawHandle = c.req.query("handle") || "";
    const handle = normalizeUserHandle(rawHandle);

    if (!handle) {
      return c.json({ error: "Handle tidak valid" }, 400);
    }

    // 1. Coba muat dari R2 terlebih dahulu jika ada
    if (c.env.BACKUP_BUCKET) {
      try {
        const obj = await c.env.BACKUP_BUCKET.get(`backups/${handle}.json`);
        if (obj) {
          const text = await obj.text();
          const parsed = JSON.parse(text);
          return c.json({
            success: true,
            handle,
            backupData: parsed,
            backupAt: Number(obj.customMetadata?.updatedAt || Date.now()),
            storage: "r2",
          });
        }
      } catch (e) {
        console.warn("R2 backup get error, fallback to D1:", e);
      }
    }

    // 2. Muat dari D1 SQLite
    const row = await d1
      .prepare(
        `SELECT backup_data, cards_count, streak_count, xp_count, updated_at
         FROM user_cloud_backups
         WHERE handle = ?`
      )
      .bind(handle)
      .first<{
        backup_data: string;
        cards_count: number;
        streak_count: number;
        xp_count: number;
        updated_at: number;
      }>();

    if (!row) {
      return c.json(
        {
          error: `Cadangan untuk ID "${handle}" tidak ditemukan. Pastikan ID sudah benar atau telah dicadangkan sebelumnya.`,
        },
        404
      );
    }

    if (row.backup_data === "r2") {
      return c.json(
        {
          error: `File cadangan untuk ID "${handle}" tidak ditemukan di cloud storage.`,
        },
        404
      );
    }

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(row.backup_data);
    } catch {
      return c.json({ error: "Format cadangan rusak" }, 500);
    }

    return c.json({
      success: true,
      handle,
      backupData: parsedData,
      backupAt: row.updated_at,
      stats: {
        cardsCount: row.cards_count,
        streakCount: row.streak_count,
        xpCount: row.xp_count,
      },
      storage: "d1",
    });
  })
  .get("/api/backup/cloud/status", async (c) => {
    const d1 = getD1(c);
    await initCommunityD1(d1);

    const rawHandle = c.req.query("handle") || "";
    const handle = normalizeUserHandle(rawHandle);

    if (!handle) {
      return c.json({ exists: false, error: "Handle tidak valid" }, 400);
    }

    // 1. Cek R2 terlebih dahulu jika bucket ada
    if (c.env.BACKUP_BUCKET) {
      try {
        const head = await c.env.BACKUP_BUCKET.head(`backups/${handle}.json`);
        if (head) {
          const updatedAt = head.customMetadata?.updatedAt
            ? Number(head.customMetadata.updatedAt)
            : head.uploaded.getTime();
          const cardsCount = head.customMetadata?.cardsCount
            ? Number(head.customMetadata.cardsCount)
            : 0;

          return c.json({
            exists: true,
            handle,
            backupAt: updatedAt,
            cardsCount,
            storage: "r2",
          });
        }
      } catch (e) {
        console.warn("R2 head error, fallback to D1 check:", e);
      }
    }

    // 2. Cek D1
    const row = await d1
      .prepare(`SELECT updated_at, cards_count FROM user_cloud_backups WHERE handle = ?`)
      .bind(handle)
      .first<{ updated_at: number; cards_count: number }>();

    if (row) {
      return c.json({
        exists: true,
        handle,
        backupAt: row.updated_at,
        cardsCount: row.cards_count,
        storage: "d1",
      });
    }

    return c.json({ exists: false, handle });
  });

// ===========================================================================
// MCP HTTP TRANSPORT — tool descriptors, schemas, D1-based handlers
// ===========================================================================

// --- Tool descriptors (for tools/list + GET /mcp discovery) ---

const TOOLS_DESCRIPTOR = [
  {
    name: "ping",
    description: "Verifikasi wiring server MCP. Mengembalikan 'pong'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_cards",
    description:
      "Daftar kartu dengan filter kategori, status due, pencarian teks, pagination, dan sorting.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        dueStatus: { type: "string", enum: ["all", "due", "new"] },
        search: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        offset: { type: "number", minimum: 0, default: 0 },
        sortBy: {
          type: "string",
          enum: ["due", "createdAt", "front"],
          default: "due",
        },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "asc" },
      },
    },
  },
  {
    name: "get_card",
    description: "Ambil satu kartu berdasarkan id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
    },
  },
  {
    name: "create_card",
    description:
      "Buat kartu baru (offline-first, FSRS defaults via createEmptyCard).",
    inputSchema: {
      type: "object",
      properties: {
        front: { type: "string", minLength: 1 },
        back: { type: "string", minLength: 1 },
        category: { type: "string" },
      },
      required: ["front", "back"],
    },
  },
  {
    name: "update_card",
    description: "Update front/back/category/due dari kartu yang sudah ada.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        front: { type: "string" },
        back: { type: "string" },
        category: { type: "string" },
        due: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_card",
    description: "Hapus kartu berdasarkan id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
    },
  },
  {
    name: "bulk_create_cards",
    description: "Buat banyak kartu sekaligus (maks 50) dalam satu insert.",
    inputSchema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              front: { type: "string", minLength: 1 },
              back: { type: "string", minLength: 1 },
              category: { type: "string" },
            },
            required: ["front", "back"],
          },
          minItems: 1,
          maxItems: 50,
        },
      },
      required: ["cards"],
    },
  },
  {
    name: "list_categories",
    description:
      "Daftar kategori beserta jumlah kartu dan jumlah due per kategori.",
    inputSchema: {
      type: "object",
      properties: {
        includeCounts: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "get_stats",
    description:
      "Statistik kartu: total, due, new, jumlah kategori, retention, dan breakdown per kategori.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string" } },
    },
  },
  {
    name: "search_cards",
    description:
      "Cari kartu berdasarkan teks pada front/back (LIKE), opsional filter kategori, diurutkan berdasarkan due.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        category: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "review_card",
    description:
      "Simulasikan review FSRS: beri rating (again/hard/good/easy), hitung nextState via fsrsEngine, persist 9 field FSRS.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        rating: { type: "string", enum: ["again", "hard", "good", "easy"] },
      },
      required: ["id", "rating"],
    },
  },
  {
    name: "import_cards",
    description:
      "Import banyak kartu sekaligus (maks 100) dalam satu insert bulk.",
    inputSchema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              front: { type: "string", minLength: 1 },
              back: { type: "string", minLength: 1 },
              category: { type: "string" },
            },
            required: ["front", "back"],
          },
          minItems: 1,
          maxItems: 100,
        },
        format: { type: "string", enum: ["json"], default: "json" },
      },
      required: ["cards"],
    },
  },
  {
    name: "export_cards",
    description:
      "Ekspor kartu (semua atau per kategori) dalam format JSON atau CSV.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        format: { type: "string", enum: ["json", "csv"], default: "json" },
      },
    },
  },
];

// --- Zod input schemas (mirror packages/mcp) ---

const PingArgsSchema = z.object({});

const ListCardsArgsSchema = z.object({
  category: z.string().optional(),
  dueStatus: z.enum(["all", "due", "new"]).optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(["due", "createdAt", "front"]).default("due"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const GetCardArgsSchema = z.object({ id: z.string().min(1) });

const CreateCardArgsSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  category: z.string().optional(),
});

const UpdateCardArgsSchema = z.object({
  id: z.string().min(1),
  front: z.string().optional(),
  back: z.string().optional(),
  category: z.string().optional(),
  due: z.string().optional(),
});

const DeleteCardArgsSchema = z.object({ id: z.string().min(1) });

const BulkCreateCardsArgsSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().min(1),
        back: z.string().min(1),
        category: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});

const ListCategoriesArgsSchema = z.object({
  includeCounts: z.boolean().default(true),
});

const GetStatsArgsSchema = z.object({
  category: z.string().optional(),
});

const SearchCardsArgsSchema = z.object({
  query: z.string().min(1),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const ReviewCardArgsSchema = z.object({
  id: z.string().min(1),
  rating: z.enum(["again", "hard", "good", "easy"]),
});

const ImportCardsArgsSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().min(1),
        back: z.string().min(1),
        category: z.string().optional(),
      }),
    )
    .min(1)
    .max(100),
  format: z.enum(["json"]).default("json"),
});

const ExportCardsArgsSchema = z.object({
  category: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

// --- Async D1-based handlers ---

type D1Db = ReturnType<typeof drizzle>;

async function handlePing(): Promise<string> {
  return "pong";
}

async function handleListCards(
  args: z.infer<typeof ListCardsArgsSchema>,
  db: D1Db,
) {
  const now = new Date();
  const conditions: (SQL | undefined)[] = [];

  if (args.category) conditions.push(eq(cards.category, args.category));
  if (args.dueStatus === "due") conditions.push(lte(cards.due, now));
  if (args.dueStatus === "new") conditions.push(eq(cards.state, 0));
  if (args.search) {
    const pattern = `%${args.search}%`;
    conditions.push(or(like(cards.front, pattern), like(cards.back, pattern)));
  }

  const where = and(...conditions);
  const orderByCol =
    args.sortBy === "createdAt"
      ? cards.createdAt
      : args.sortBy === "front"
        ? cards.front
        : cards.due;
  const orderBy = args.sortOrder === "desc" ? desc(orderByCol) : asc(orderByCol);

  const rows = await db
    .select()
    .from(cards)
    .where(where)
    .orderBy(orderBy)
    .limit(args.limit)
    .offset(args.offset)
    .all();
  const total =
    (
      await db.select({ count: count() }).from(cards).where(where).get()
    )?.count ?? 0;

  return { cards: rows, total, hasMore: args.offset + rows.length < total };
}

async function handleGetCard(
  args: z.infer<typeof GetCardArgsSchema>,
  db: D1Db,
) {
  const row = await db.select().from(cards).where(eq(cards.id, args.id)).get();
  if (!row) throw new Error(`Card not found: ${args.id}`);
  return row;
}

function buildInsertCard(
  front: string,
  back: string,
  category: string | undefined,
  now: Date,
): typeof cards.$inferInsert {
  const emptyCard = createEmptyCard(now);
  return {
    id: crypto.randomUUID(),
    front: front.trim(),
    back: back.trim(),
    category: category?.trim() || "general",
    due: now,
    stability: emptyCard.stability,
    difficulty: emptyCard.difficulty,
    state: emptyCard.state,
    elapsed_days: emptyCard.elapsed_days,
    scheduled_days: emptyCard.scheduled_days,
    reps: emptyCard.reps,
    lapses: emptyCard.lapses,
    last_review: emptyCard.last_review ?? null,
    createdAt: now,
  };
}

async function handleCreateCard(
  args: z.infer<typeof CreateCardArgsSchema>,
  db: D1Db,
) {
  const card = buildInsertCard(args.front, args.back, args.category, new Date());
  await db.insert(cards).values(card).run();
  return await db.select().from(cards).where(eq(cards.id, card.id as string)).get();
}

async function handleUpdateCard(
  args: z.infer<typeof UpdateCardArgsSchema>,
  db: D1Db,
) {
  const existing = await db
    .select()
    .from(cards)
    .where(eq(cards.id, args.id))
    .get();
  if (!existing) throw new Error(`Card not found: ${args.id}`);

  const setData: Partial<typeof cards.$inferInsert> = {};
  if (args.front !== undefined) setData.front = args.front.trim();
  if (args.back !== undefined) setData.back = args.back.trim();
  if (args.category !== undefined)
    setData.category = args.category.trim() || "general";
  if (args.due !== undefined) {
    const due = new Date(args.due);
    if (Number.isNaN(due.getTime()))
      throw new Error(`Invalid due date: ${args.due}`);
    setData.due = due;
  }

  if (Object.keys(setData).length === 0) return existing;
  return await db
    .update(cards)
    .set(setData)
    .where(eq(cards.id, args.id))
    .returning()
    .get();
}

async function handleDeleteCard(
  args: z.infer<typeof DeleteCardArgsSchema>,
  db: D1Db,
) {
  const existing = await db
    .select()
    .from(cards)
    .where(eq(cards.id, args.id))
    .get();
  if (!existing) throw new Error(`Card not found: ${args.id}`);
  await db.delete(cards).where(eq(cards.id, args.id)).run();
  return { deleted: args.id, success: true };
}

async function handleBulkCreateCards(
  args: z.infer<typeof BulkCreateCardsArgsSchema>,
  db: D1Db,
) {
  const now = new Date();
  const rows: typeof cards.$inferInsert[] = args.cards.map((c) =>
    buildInsertCard(c.front, c.back, c.category, now),
  );
  const chunkSize = 6;
  for (let i = 0; i < rows.length; i += chunkSize) {
      await db
        .insert(cards)
        .values(rows.slice(i, i + chunkSize))
        .onConflictDoNothing()
        .run();
  }
  const ids = rows.map((r) => r.id as string);
  const created = await db.select().from(cards).where(or(...ids.map((id) => eq(cards.id, id)))).all();
  return { created, count: created.length };
}

async function handleListCategories(
  args: z.infer<typeof ListCategoriesArgsSchema>,
  db: D1Db,
) {
  const now = new Date();

  const grouped = await db
    .select({ category: cards.category, count: count() })
    .from(cards)
    .groupBy(cards.category)
    .all();

  let dueMap = new Map<string, number>();
  if (args.includeCounts) {
    const dueGrouped = await db
      .select({ category: cards.category, count: count() })
      .from(cards)
      .where(lte(cards.due, now))
      .groupBy(cards.category)
      .all();
    dueMap = new Map(dueGrouped.map((r) => [r.category, r.count]));
  }

  const categories = grouped
    .map((r) => ({
      category: r.category,
      count: r.count,
      ...(args.includeCounts ? { dueCount: dueMap.get(r.category) ?? 0 } : {}),
    }))
    .sort((a, b) => {
      if (a.category === "general") return -1;
      if (b.category === "general") return 1;
      return a.category.localeCompare(b.category);
    });

  return { categories };
}

async function handleGetStats(
  args: z.infer<typeof GetStatsArgsSchema>,
  db: D1Db,
) {
  const now = new Date();
  const baseWhere = args.category
    ? eq(cards.category, args.category)
    : undefined;

  const total =
    (
      await db.select({ count: count() }).from(cards).where(baseWhere).get()
    )?.count ?? 0;
  const due =
    (
      await db
        .select({ count: count() })
        .from(cards)
        .where(and(baseWhere, lte(cards.due, now)))
        .get()
    )?.count ?? 0;
  const newCount =
    (
      await db
        .select({ count: count() })
        .from(cards)
        .where(and(baseWhere, eq(cards.state, 0)))
        .get()
    )?.count ?? 0;
  const categoriesCount = args.category
    ? 1
    : (
        await db
          .select({ category: cards.category })
          .from(cards)
          .groupBy(cards.category)
          .all()
      ).length;
  const retention = total > 0 ? Math.round(((total - due) / total) * 100) : 0;
  const perCategory = args.category
    ? undefined
    : await db
        .select({ category: cards.category, count: count() })
        .from(cards)
        .groupBy(cards.category)
        .all();

  return { total, due, newCount, categoriesCount, retention, perCategory };
}

async function handleSearchCards(
  args: z.infer<typeof SearchCardsArgsSchema>,
  db: D1Db,
) {
  const pattern = `%${args.query}%`;
  const conditions: (SQL | undefined)[] = [
    or(like(cards.front, pattern), like(cards.back, pattern)),
  ];
  if (args.category) conditions.push(eq(cards.category, args.category));

  const rows = await db
    .select()
    .from(cards)
    .where(and(...conditions))
    .orderBy(asc(cards.due))
    .limit(args.limit)
    .all();

  return { query: args.query, cards: rows, count: rows.length };
}

const RATING_MAP = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

async function handleReviewCard(
  args: z.infer<typeof ReviewCardArgsSchema>,
  db: D1Db,
) {
  const existing = await db
    .select()
    .from(cards)
    .where(eq(cards.id, args.id))
    .get();
  if (!existing) throw new Error(`Card not found: ${args.id}`);

  // D1 returns Date objects for timestamp columns; fsrsEngine expects Date-compatible values
  const card: FSRSCard = {
    due: existing.due,
    stability: existing.stability,
    difficulty: existing.difficulty,
    elapsed_days: existing.elapsed_days,
    scheduled_days: existing.scheduled_days,
    learning_steps: existing.learning_steps ?? 0,
    reps: existing.reps,
    lapses: existing.lapses,
    state: existing.state as FSRSCard["state"],
    last_review: existing.last_review ?? undefined,
  };
  const nextState = fsrsEngine.repeat(card, new Date())[
    RATING_MAP[args.rating]
  ].card;

  const setData: Partial<typeof cards.$inferInsert> = {
    due: nextState.due,
    stability: nextState.stability,
    difficulty: nextState.difficulty,
    state: nextState.state,
    elapsed_days: nextState.elapsed_days,
    scheduled_days: nextState.scheduled_days,
    learning_steps: nextState.learning_steps,
    reps: nextState.reps,
    lapses: nextState.lapses,
    last_review: nextState.last_review,
  };
  await db.update(cards).set(setData).where(eq(cards.id, args.id)).run();

  return {
    reviewed: args.id,
    rating: args.rating,
    nextDue: nextState.due,
    nextState,
  };
}

async function handleImportCards(
  args: z.infer<typeof ImportCardsArgsSchema>,
  db: D1Db,
) {
  const now = new Date();
  const rows: typeof cards.$inferInsert[] = args.cards.map((c) =>
    buildInsertCard(c.front, c.back, c.category, now),
  );
  const chunkSize = 6;
  for (let i = 0; i < rows.length; i += chunkSize) {
      await db
        .insert(cards)
        .values(rows.slice(i, i + chunkSize))
        .onConflictDoNothing()
        .run();
  }
  return { imported: rows.length };
}

async function handleExportCards(
  args: z.infer<typeof ExportCardsArgsSchema>,
  db: D1Db,
) {
  const where = args.category
    ? eq(cards.category, args.category)
    : undefined;
  const rows = await db
    .select()
    .from(cards)
    .where(where)
    .orderBy(asc(cards.due))
    .all();

  if (args.format === "csv") {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [
        escape(r.front),
        escape(r.back),
        escape(r.category),
        r.due instanceof Date ? r.due.toISOString() : String(r.due),
      ].join(","),
    );
    return ["front,back,category,due", ...lines].join("\n");
  }

  return { cards: rows, count: rows.length };
}

// --- Tool registry: name → { schema, handler } ---

const MCP_TOOLS: Record<
  string,
  {
    schema: z.ZodTypeAny;
    handler: (args: never, db: D1Db) => Promise<unknown>;
  }
> = {
  ping: {
    schema: PingArgsSchema,
    handler: (() => handlePing()) as (args: never, db: D1Db) => Promise<unknown>,
  },
  list_cards: {
    schema: ListCardsArgsSchema,
    handler: handleListCards as (args: never, db: D1Db) => Promise<unknown>,
  },
  get_card: {
    schema: GetCardArgsSchema,
    handler: handleGetCard as (args: never, db: D1Db) => Promise<unknown>,
  },
  create_card: {
    schema: CreateCardArgsSchema,
    handler: handleCreateCard as (args: never, db: D1Db) => Promise<unknown>,
  },
  update_card: {
    schema: UpdateCardArgsSchema,
    handler: handleUpdateCard as (args: never, db: D1Db) => Promise<unknown>,
  },
  delete_card: {
    schema: DeleteCardArgsSchema,
    handler: handleDeleteCard as (args: never, db: D1Db) => Promise<unknown>,
  },
  bulk_create_cards: {
    schema: BulkCreateCardsArgsSchema,
    handler: handleBulkCreateCards as (
      args: never,
      db: D1Db,
    ) => Promise<unknown>,
  },
  list_categories: {
    schema: ListCategoriesArgsSchema,
    handler: handleListCategories as (
      args: never,
      db: D1Db,
    ) => Promise<unknown>,
  },
  get_stats: {
    schema: GetStatsArgsSchema,
    handler: handleGetStats as (args: never, db: D1Db) => Promise<unknown>,
  },
  search_cards: {
    schema: SearchCardsArgsSchema,
    handler: handleSearchCards as (args: never, db: D1Db) => Promise<unknown>,
  },
  review_card: {
    schema: ReviewCardArgsSchema,
    handler: handleReviewCard as (args: never, db: D1Db) => Promise<unknown>,
  },
  import_cards: {
    schema: ImportCardsArgsSchema,
    handler: handleImportCards as (args: never, db: D1Db) => Promise<unknown>,
  },
  export_cards: {
    schema: ExportCardsArgsSchema,
    handler: handleExportCards as (args: never, db: D1Db) => Promise<unknown>,
  },
};

// ===========================================================================
// MCP HTTP ROUTES — GET (discovery) + POST (JSON-RPC)
// ===========================================================================

const mcpRoutes = routes
  .get("/mcp", async (c) => {
    return c.json({
      name: "flashcard-mcp",
      version: "1.0.0",
      transport: "http",
      tools: TOOLS_DESCRIPTOR,
    });
  })
  .post("/mcp", async (c) => {
    // Optional Bearer token auth
    const mcpToken = c.env.MCP_TOKEN;
    if (mcpToken) {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${mcpToken}`) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message: "Unauthorized" },
          },
          401,
        );
      }
    }

    let body: {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400,
      );
    }

    const { id, method, params } = body;

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "flashcard-mcp", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS_DESCRIPTOR },
      });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      if (typeof toolName !== "string") {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name" },
        });
      }

      const tool = MCP_TOOLS[toolName];
      if (!tool) {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      try {
        const args = tool.schema.parse(params?.arguments ?? {});
        const db = drizzle(getD1(c));
        const result = await (tool.handler as (
          a: typeof args,
          d: D1Db,
        ) => Promise<unknown>)(args, db);
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (error) {
        const err = error as Error & { cause?: unknown; message?: string };
        const cause = err.cause as { message?: string; toString?: () => string } | undefined;
        const causeMsg = cause?.message ?? (cause ? String(cause) : "no cause");
        const message =
          err instanceof Error
            ? `${err.message}\ncauseMsg: ${causeMsg}\ncauseStr: ${String(err.cause)}\nstack: ${err.stack?.slice(0, 800)}`
            : JSON.stringify(error, null, 2);
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: message }],
            isError: true,
          },
        });
      }
    }

    // Unknown method
    return c.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });

export type AppType = typeof mcpRoutes;
export default app;
