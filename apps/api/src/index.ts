// apps/api/src/index.ts
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { cards } from "@flashcard/db"; // Mengambil skema dari workspace internal
import { cors } from "hono/cors";
import type { D1Database } from "@cloudflare/workers-types";

// Deklarasi tipe Environment Variables / Bindings untuk Cloudflare
type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Wajib untuk TanStack Start lokal (beda port)
app.use("/api/*", cors());

const routes = app
  .get("/api/cards", async (c) => {
    // 1. Inisialisasi Drizzle dengan binding D1 dari Cloudflare
    const db = drizzle(c.env.DB);

    // 2. Query ke D1 menggunakan Drizzle ORM
    const allCards = await db.select().from(cards).all();

    return c.json(allCards);
  })
  .post("/api/cards", async (c) => {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();

    // Contoh Insert Data
    const newCard = await db
      .insert(cards)
      .values({
        id: crypto.randomUUID(),
        front: body.front,
        back: body.back,
        category: body.category?.trim() || "general",
        due: new Date(),
      })
      .returning()
      .get();

    return c.json(newCard);
  })
  .get("/api/hello", async (c) => {
    return c.json({ message: "Hello from Cloudflare D1!" });
  })
  .post("/api/sync", async (c) => {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();
    const actions = body.actions; // Array dari SyncAction

    // Kumpulkan semua operasi update ke dalam array
    const batchUpdates: BatchItem<"sqlite">[] = [];

    for (const item of actions) {
      if (item.action === "REVIEW_CARD") {
        const { id, nextState } = item.payload;

        // category bukan bagian dari FSRS review — disinkronkan hanya jika payload.category ada
        const setData: Partial<typeof cards.$inferInsert> = {
          due: new Date(nextState.due),
          state: nextState.state,
          stability: nextState.stability,
          difficulty: nextState.difficulty,
          elapsed_days: nextState.elapsed_days,
          scheduled_days: nextState.scheduled_days,
          reps: nextState.reps,
          lapses: nextState.lapses,
          last_review: nextState.last_review
            ? new Date(nextState.last_review)
            : null,
        };

        if (item.payload.category) {
          setData.category = item.payload.category;
        }

        // Buat perintah update Drizzle, tapi jangan dieksekusi dulu
        const updateQuery = db
          .update(cards)
          .set(setData)
          .where(eq(cards.id, id));

        batchUpdates.push(updateQuery);
      }
    }

    // Eksekusi semua update sekaligus menggunakan fitur batch D1
    if (batchUpdates.length > 0) {
      await db.batch(
        batchUpdates as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    }

    return c.json({ success: true, processed: batchUpdates.length });
  });

export type AppType = typeof routes;
export default app;
