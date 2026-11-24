// apps/api/src/routes/backup.ts
// Cadangan cloud (R2 + D1): POST/GET /api/backup/cloud,
// GET /api/backup/cloud/status.
import { Hono } from "hono";
import { normalizeUserHandle } from "@flashcard/shared";
import { getD1, type Bindings } from "../lib/env";
import { initCommunityD1 } from "../lib/community";

export const backupRoutes = new Hono<{ Bindings: Bindings }>()
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
