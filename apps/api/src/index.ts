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
import { eq as drizzleEq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { cards } from "@flashcard/db";
import { cors } from "hono/cors";
import {
  Rating,
  createEmptyCard,
  fsrsEngine,
  type FSRSCard,
} from "@flashcard/shared";
import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

type Bindings = {
  DB: D1Database;
  MCP_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS for both /api/* and /mcp (remote AI callers)
app.use("/*", cors());

// ===========================================================================
// EXISTING API ROUTES (unchanged)
// ===========================================================================

const routes = app
  .get("/api/cards", async (c) => {
    const db = drizzle(c.env.DB);
    const allCards = await db.select().from(cards).all();
    return c.json(allCards);
  })
  .post("/api/cards", async (c) => {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();
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
    const actions = body.actions;

    const batchUpdates: BatchItem<"sqlite">[] = [];

    for (const item of actions) {
      if (item.action === "REVIEW_CARD") {
        const { id, nextState } = item.payload;

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

        const updateQuery = db
          .update(cards)
          .set(setData)
          .where(drizzleEq(cards.id, id));

        batchUpdates.push(updateQuery);
      }
    }

    if (batchUpdates.length > 0) {
      await db.batch(
        batchUpdates as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    }

    return c.json({ success: true, processed: batchUpdates.length });
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
  return await db.insert(cards).values(card).returning().get();
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
  const created = await db.insert(cards).values(rows).returning().all();
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
    learning_steps: 0,
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
  await db.insert(cards).values(rows).run();
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
        const db = drizzle(c.env.DB);
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
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
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
