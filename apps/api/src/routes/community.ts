// apps/api/src/routes/community.ts
// Komunitas: WS /ws/community + REST /api/community/messages
// (GET/POST/DELETE), /api/community/heartbeat. State broadcast (set koneksi
// WS + histori pesan) tinggal di modul ini; index.ts tidak memegang state.
import { Hono } from "hono";
import { getD1, type Bindings } from "../lib/env";
import {
  initCommunityD1,
  verifyAdminKey,
  type CommunityMessageDto,
} from "../lib/community";

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

export const communityRoutes = new Hono<{ Bindings: Bindings }>()
    .get("/ws/community", async (c) => {
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
  });
