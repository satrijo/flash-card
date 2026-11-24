// packages/mcp/src/index.ts
// MCP stdio server untuk Flashcard SRS.
// Menyediakan 8 tool manajemen kartu (list/get/create/update/delete/bulk/categories/stats)
// + 4 tool advanced (search/review/import/export) + tool "ping" untuk health check.
// Semua query via drizzle-orm + better-sqlite3.
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
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
import * as schema from "@flashcard/db";
import { cards } from "@flashcard/db";
import {
  FSRS_RATINGS,
  buildFsrsUpdate,
  createEmptyCard,
  normalizeCategory,
  type FSRSCard,
} from "@flashcard/shared";

// ---------------------------------------------------------------------------
// Koneksi database (better-sqlite3)
// ---------------------------------------------------------------------------

// Cari file SQLite D1 lokal dari Wrangler (miniflare). Pilih yang terbaru.
function findWranglerDb(): string | null {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ];
  for (const root of roots) {
    const d1Dir = path.join(root, ".wrangler", "state", "v3", "d1");
    if (!fs.existsSync(d1Dir)) continue;
    let best: { file: string; mtime: number } | null = null;
    for (const entry of fs.readdirSync(d1Dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("miniflare-D1DatabaseObject")) {
        continue;
      }
      const sub = path.join(d1Dir, entry.name);
      for (const file of fs.readdirSync(sub)) {
        if (!file.endsWith(".sqlite")) continue;
        const full = path.join(sub, file);
        const st = fs.statSync(full);
        if (!best || st.mtimeMs > best.mtime) {
          best = { file: full, mtime: st.mtimeMs };
        }
      }
    }
    if (best) return best.file;
  }
  return null;
}

function createDb() {
  const envPath = process.env.DB_PATH;
  const wranglerPath = findWranglerDb();
  const localPath = path.resolve(process.cwd(), "packages/db/flashcard.db");

  let dbPath: string;
  if (envPath) {
    dbPath = envPath;
  } else if (wranglerPath) {
    dbPath = wranglerPath;
  } else if (fs.existsSync(localPath)) {
    dbPath = localPath;
  } else {
    // Fallback in-memory (untuk test / tanpa DB lokal).
    dbPath = ":memory:";
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  // Pastikan tabel `cards` ada (untuk DB in-memory / fallback tanpa migrasi).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "cards" (
      "id" text PRIMARY KEY NOT NULL,
      "front" text NOT NULL,
      "back" text NOT NULL,
      "category" text DEFAULT 'general' NOT NULL,
      "due" integer NOT NULL,
      "stability" real DEFAULT 0 NOT NULL,
      "difficulty" real DEFAULT 0 NOT NULL,
      "state" integer DEFAULT 0 NOT NULL,
      "elapsed_days" real DEFAULT 0 NOT NULL,
      "scheduled_days" real DEFAULT 0 NOT NULL,
      "reps" integer DEFAULT 0 NOT NULL,
      "lapses" integer DEFAULT 0 NOT NULL,
      "last_review" integer,
      "created_at" integer DEFAULT (strftime('%s', 'now')) NOT NULL
    );
  `);
  return drizzle({ client: sqlite });
}

let cachedDb: ReturnType<typeof createDb> | null = null;

function getDb() {
  if (!cachedDb) cachedDb = createDb();
  return cachedDb;
}

// ---------------------------------------------------------------------------
// Helper: konversi schema zod -> JSON Schema (untuk ListTools)
// ---------------------------------------------------------------------------

function zodToJsonSchema(schemaDef: z.ZodTypeAny): Record<string, unknown> {
  if (schemaDef instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schemaDef.shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return { type: "object", properties, required };
  }
  if (schemaDef instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    if (schemaDef.minLength !== null) out.minLength = schemaDef.minLength;
    if (schemaDef.maxLength !== null) out.maxLength = schemaDef.maxLength;
    return out;
  }
  if (schemaDef instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    if (schemaDef.minValue !== null) out.minimum = schemaDef.minValue;
    if (schemaDef.maxValue !== null) out.maximum = schemaDef.maxValue;
    return out;
  }
  if (schemaDef instanceof z.ZodBoolean) return { type: "boolean" };
  if (schemaDef instanceof z.ZodEnum) {
    return { type: "string", enum: schemaDef.options };
  }
  if (schemaDef instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schemaDef.element) };
  }
  if (schemaDef instanceof z.ZodOptional) return zodToJsonSchema(schemaDef.unwrap());
  if (schemaDef instanceof z.ZodDefault) return zodToJsonSchema(schemaDef._def.innerType);
  if (schemaDef instanceof z.ZodLiteral) return { const: schemaDef.value };
  if (schemaDef instanceof z.ZodUnion) {
    return { anyOf: schemaDef.options.map((o: z.ZodTypeAny) => zodToJsonSchema(o)) };
  }
  return { type: "object" };
}

// ---------------------------------------------------------------------------
// Registrasi tool
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<unknown>;
}

function defineTool<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  argsSchema: T,
  handler: (args: z.output<T>) => unknown,
): ToolDef {
  return {
    name,
    description,
    inputSchema: zodToJsonSchema(argsSchema),
    handler: async (raw) => {
      const args = argsSchema.parse(raw);
      return handler(args);
    },
  };
}

// ---------------------------------------------------------------------------
// Schema argumen per tool
// ---------------------------------------------------------------------------

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

// --- Advanced tools ---

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

// ---------------------------------------------------------------------------
// Handler tool
// ---------------------------------------------------------------------------

function listCards(args: z.infer<typeof ListCardsArgsSchema>) {
  const db = getDb();
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

  const rows = db
    .select()
    .from(cards)
    .where(where)
    .orderBy(orderBy)
    .limit(args.limit)
    .offset(args.offset)
    .all();
  const total = db.select({ count: count() }).from(cards).where(where).get()?.count ?? 0;

  return { cards: rows, total, hasMore: args.offset + rows.length < total };
}

function getCard(args: z.infer<typeof GetCardArgsSchema>) {
  const db = getDb();
  const row = db.select().from(cards).where(eq(cards.id, args.id)).get();
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
    category: normalizeCategory(category),
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

function createCard(args: z.infer<typeof CreateCardArgsSchema>) {
  const db = getDb();
  const card = buildInsertCard(args.front, args.back, args.category, new Date());
  return db.insert(cards).values(card).returning().get();
}

function updateCard(args: z.infer<typeof UpdateCardArgsSchema>) {
  const db = getDb();
  const existing = db.select().from(cards).where(eq(cards.id, args.id)).get();
  if (!existing) throw new Error(`Card not found: ${args.id}`);

  const setData: Partial<typeof cards.$inferInsert> = {};
  if (args.front !== undefined) setData.front = args.front.trim();
  if (args.back !== undefined) setData.back = args.back.trim();
  if (args.category !== undefined) setData.category = normalizeCategory(args.category);
  if (args.due !== undefined) {
    const due = new Date(args.due);
    if (Number.isNaN(due.getTime())) throw new Error(`Invalid due date: ${args.due}`);
    setData.due = due;
  }

  if (Object.keys(setData).length === 0) return existing;
  return db.update(cards).set(setData).where(eq(cards.id, args.id)).returning().get();
}

function deleteCard(args: z.infer<typeof DeleteCardArgsSchema>) {
  const db = getDb();
  const existing = db.select().from(cards).where(eq(cards.id, args.id)).get();
  if (!existing) throw new Error(`Card not found: ${args.id}`);
  db.delete(cards).where(eq(cards.id, args.id)).run();
  return { deleted: args.id, success: true };
}

function bulkCreateCards(args: z.infer<typeof BulkCreateCardsArgsSchema>) {
  const db = getDb();
  const now = new Date();
  const rows: typeof cards.$inferInsert[] = args.cards.map((c) =>
    buildInsertCard(c.front, c.back, c.category, now),
  );
  const created = db.insert(cards).values(rows).returning().all();
  return { created, count: created.length };
}

function listCategories(args: z.infer<typeof ListCategoriesArgsSchema>) {
  const db = getDb();
  const now = new Date();

  const grouped = db
    .select({ category: cards.category, count: count() })
    .from(cards)
    .groupBy(cards.category)
    .all();

  let dueMap = new Map<string, number>();
  if (args.includeCounts) {
    const dueGrouped = db
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

function getStats(args: z.infer<typeof GetStatsArgsSchema>) {
  const db = getDb();
  const now = new Date();
  const baseWhere = args.category ? eq(cards.category, args.category) : undefined;

  const total = db.select({ count: count() }).from(cards).where(baseWhere).get()?.count ?? 0;
  const due =
    db
      .select({ count: count() })
      .from(cards)
      .where(and(baseWhere, lte(cards.due, now)))
      .get()?.count ?? 0;
  const newCount =
    db
      .select({ count: count() })
      .from(cards)
      .where(and(baseWhere, eq(cards.state, 0)))
      .get()?.count ?? 0;
  const categoriesCount = args.category
    ? 1
    : db.select({ category: cards.category }).from(cards).groupBy(cards.category).all().length;
  const retention = total > 0 ? Math.round(((total - due) / total) * 100) : 0;
  const perCategory = args.category
    ? undefined
    : db
        .select({ category: cards.category, count: count() })
        .from(cards)
        .groupBy(cards.category)
        .all();

  return { total, due, newCount, categoriesCount, retention, perCategory };
}

function searchCards(args: z.infer<typeof SearchCardsArgsSchema>) {
  const db = getDb();
  const pattern = `%${args.query}%`;
  const conditions: (SQL | undefined)[] = [
    or(like(cards.front, pattern), like(cards.back, pattern)),
  ];
  if (args.category) conditions.push(eq(cards.category, args.category));

  const rows = db
    .select()
    .from(cards)
    .where(and(...conditions))
    .orderBy(asc(cards.due))
    .limit(args.limit)
    .all();

  return { query: args.query, cards: rows, count: rows.length };
}

function reviewCard(args: z.infer<typeof ReviewCardArgsSchema>) {
  const db = getDb();
  const existing = db.select().from(cards).where(eq(cards.id, args.id)).get();
  if (!existing) throw new Error(`Card not found: ${args.id}`);

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
  const nextState = buildFsrsUpdate(card, FSRS_RATINGS[args.rating], new Date());

  const setData: Partial<typeof cards.$inferInsert> = { ...nextState };
  db.update(cards).set(setData).where(eq(cards.id, args.id)).run();

  return { reviewed: args.id, rating: args.rating, nextDue: nextState.due, nextState };
}

function importCards(args: z.infer<typeof ImportCardsArgsSchema>) {
  const db = getDb();
  const now = new Date();
  const rows: typeof cards.$inferInsert[] = args.cards.map((c) =>
    buildInsertCard(c.front, c.back, c.category, now),
  );
  db.insert(cards).values(rows).run();
  return { imported: rows.length };
}

function exportCards(args: z.infer<typeof ExportCardsArgsSchema>) {
  const db = getDb();
  const where = args.category ? eq(cards.category, args.category) : undefined;
  const rows = db.select().from(cards).where(where).orderBy(asc(cards.due)).all();

  if (args.format === "csv") {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [
        escape(r.front),
        escape(r.back),
        escape(r.category),
        r.due instanceof Date ? r.due.toISOString() : new Date(r.due).toISOString(),
      ].join(","),
    );
    return ["front,back,category,due", ...lines].join("\n");
  }

  return { cards: rows, count: rows.length };
}

// ---------------------------------------------------------------------------
// Daftar tool (ping + 8 core + 4 advanced = 13)
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  defineTool(
    "ping",
    "Verifikasi wiring server MCP. Mengembalikan 'pong'.",
    PingArgsSchema,
    () => "pong",
  ),
  defineTool(
    "list_cards",
    "Daftar kartu dengan filter kategori, status due, pencarian teks, pagination, dan sorting.",
    ListCardsArgsSchema,
    listCards,
  ),
  defineTool(
    "get_card",
    "Ambil satu kartu berdasarkan id.",
    GetCardArgsSchema,
    getCard,
  ),
  defineTool(
    "create_card",
    "Buat kartu baru (offline-first, FSRS defaults via createEmptyCard).",
    CreateCardArgsSchema,
    createCard,
  ),
  defineTool(
    "update_card",
    "Update front/back/category/due dari kartu yang sudah ada.",
    UpdateCardArgsSchema,
    updateCard,
  ),
  defineTool(
    "delete_card",
    "Hapus kartu berdasarkan id.",
    DeleteCardArgsSchema,
    deleteCard,
  ),
  defineTool(
    "bulk_create_cards",
    "Buat banyak kartu sekaligus (maks 50) dalam satu insert.",
    BulkCreateCardsArgsSchema,
    bulkCreateCards,
  ),
  defineTool(
    "list_categories",
    "Daftar kategori beserta jumlah kartu dan jumlah due per kategori.",
    ListCategoriesArgsSchema,
    listCategories,
  ),
  defineTool(
    "get_stats",
    "Statistik kartu: total, due, new, jumlah kategori, retention, dan breakdown per kategori.",
    GetStatsArgsSchema,
    getStats,
  ),
  defineTool(
    "search_cards",
    "Cari kartu berdasarkan teks pada front/back (LIKE), opsional filter kategori, diurutkan berdasarkan due.",
    SearchCardsArgsSchema,
    searchCards,
  ),
  defineTool(
    "review_card",
    "Simulasikan review FSRS: beri rating (again/hard/good/easy), hitung nextState via fsrsEngine, persist 9 field FSRS.",
    ReviewCardArgsSchema,
    reviewCard,
  ),
  defineTool(
    "import_cards",
    "Import banyak kartu sekaligus (maks 100) dalam satu insert bulk.",
    ImportCardsArgsSchema,
    importCards,
  ),
  defineTool(
    "export_cards",
    "Ekspor kartu (semua atau per kategori) dalam format JSON atau CSV.",
    ExportCardsArgsSchema,
    exportCards,
  ),
];

// ---------------------------------------------------------------------------
// Server MCP
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "flashcard-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return JSON.stringify(error, null, 2);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${request.params.name}`,
    );
  }
  try {
    const result = await tool.handler(request.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: formatError(error) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("flashcard-mcp server running on stdio");
