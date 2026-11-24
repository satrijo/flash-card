// apps/api/src/routes/deck.ts
// Deck read-only + handle pengguna: GET /api/hello, /api/deck/version,
// /api/deck/cards, GET /api/user/check-handle, POST /api/user/claim-handle.
// Server hanyalah perpustakaan kartu bersama; progress belajar tidak pernah
// dikirim balik ke sini (murni IndexedDB per device).
import { Hono } from "hono";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { cards } from "@flashcard/db";
import { isReservedHandle, normalizeUserHandle } from "@flashcard/shared";
import { getD1, type Bindings } from "../lib/env";
import { initCommunityD1, verifyAdminKey } from "../lib/community";
import {
  deckVersionFromRows,
  getCachedDeckVersion,
  setCachedDeckVersion,
} from "../lib/deck-version";

export const deckRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/api/hello", async (c) => {
    return c.json({ message: "Hello from Cloudflare D1!" });
  })
  .get("/api/deck/version", async (c) => {
    const now = Date.now();
    const cached = getCachedDeckVersion();
    if (cached && now < cached.expiresAt) {
      c.header("Cache-Control", "public, max-age=300, s-maxage=1800");
      return c.json({
        version: cached.version,
        count: cached.count,
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
    setCachedDeckVersion({
      version,
      count: rows.length,
      expiresAt: now + 300_000, // Cache di Worker memori selama 5 menit
    });

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
  });
