// packages/db/seed.ts — Seeder CSV-based untuk Flashcard SRS
// Sumber data: packages/db/seed/*.csv (4 file, ~19.8k baris total)
//   - inggris-easy.csv    3623  (A1/A2, kata frekuensi tinggi)
//   - inggris-medium.csv  5237  (B1/B2, frasa & kalimat)
//   - inggris-advance.csv 9952  (C1/C2, akademik)
//   - inggris-native.csv  1016  (idiom & slang native)
// Dikategorikan otomatis dari kamus gKamus (kamus.sql) + daftar idiom/slang asli.
// Kata panjang → "advance" (rasanya jarang/lebih tinggi); frasa/slang/hyphenated → "native".
// Semua front unik GLOBAL (UNIQUE di schema), tanpa suffix angka curang (" 2", " (2)").
// Seed idempotent: re-run melewati kartu yang sudah ada (ON CONFLICT DO NOTHING).
// Jalankan: pnpm --filter @flashcard/db run db:seed        → lokal (better-sqlite3 / .wrangler)
//           pnpm --filter @flashcard/db run db:seed:remote → production via API_URL

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { cards } from "./index.ts";
import { createEmptyCard } from "../shared/index.ts";

const API_URL = process.env.API_URL || "https://api.codeverflow.workers.dev";
const isRemote = process.argv.includes("--remote");
const SEED_DIR = path.resolve(import.meta.dirname ?? ".", "./seed");

function readCSV(file: string): Array<{ front: string; back: string; category: string }> {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.trim().split("\n");
  const rows: Array<{ front: string; back: string; category: string }> = [];
  // Parse CSV dengan quote handling sederhana (file di-generate dengan csv.QUOTE_ALL)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Gunakan regex untuk split CSV quoted
    const m = line.match(/^"((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)"$/);
    if (!m) continue;
    const front = m[1].replace(/""/g, '"');
    const back = m[2].replace(/""/g, '"');
    const category = m[3].replace(/""/g, '"');
    rows.push({ front, back, category });
  }
  return rows;
}

function loadAll(): Array<{ front: string; back: string; category: string }> {
  const files = ["inggris-easy.csv", "inggris-medium.csv", "inggris-advance.csv", "inggris-native.csv"];
  const all: Array<{ front: string; back: string; category: string }> = [];
  for (const f of files) {
    const p = path.join(SEED_DIR, f);
    if (!fs.existsSync(p)) throw new Error(`Seed file tidak ditemukan: ${p}`);
    const rows = readCSV(p);
    console.log(`  ${f}: ${rows.length} rows`);
    all.push(...rows);
  }
  // Validasi unik front+category & tanpa suffix angka curang
  const seen = new Set<string>();
  for (const r of all) {
    const key = `${r.front.toLowerCase()}::${r.category}`;
    if (seen.has(key)) throw new Error(`Duplicate front terdeteksi: ${r.front} [${r.category}]`);
    seen.add(key);
    if (/\s\(\d+\)$/.test(r.front) || /\s[2-9]$/.test(r.front) || /\s1[0-9]$/.test(r.front)) {
      throw new Error(`Suffix angka curang terdeteksi: ${r.front}`);
    }
  }
  console.log(`Validasi: ${all.length} unik, tanpa suffix angka — OK`);
  return all;
}

async function seedLocal(rows: Array<{ front: string; back: string; category: string }>) {
  // Cari DB lokal: DB_PATH > .wrangler > fallback
  const candidates = [
    process.env.DB_PATH,
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
    "packages/db/seed.db",
  ];
  let dbPath = ":memory:";
  for (const c of candidates) {
    if (!c) continue;
    if (c.includes("miniflare")) {
      // cari file sqlite terbaru
      const base = path.resolve(c);
      if (!fs.existsSync(base)) continue;
      let best: { file: string; mtime: number } | null = null;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("miniflare")) continue;
        const sub = path.join(base, entry.name);
        for (const file of fs.readdirSync(sub)) {
          if (!file.endsWith(".sqlite")) continue;
          const full = path.join(sub, file);
          const st = fs.statSync(full);
          if (!best || st.mtimeMs > best.mtime) best = { file: full, mtime: st.mtimeMs };
        }
      }
      if (best) { dbPath = best.file; break; }
    } else if (fs.existsSync(c) || c === ":memory:") {
      dbPath = c;
      break;
    }
  }
  console.log(`Local DB: ${dbPath}`);
  const sqlite = new Database(dbPath);
  const db = drizzle({ client: sqlite as never } as never);
  // Kosongkan dulu (opsional, biar idempoten)
  // await db.delete(cards).run(); // jangan auto-hapus, biar eksplisit via wrangler

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const inserts = chunk.map(({ front, back, category }) => {
      const base = createEmptyCard(new Date());
      return {
        id: crypto.randomUUID(),
        front,
        back,
        category,
        ...base,
        due: new Date(),
        last_review: null as Date | null,
        createdAt: new Date(),
      };
    });
    for (let k = 0; k < inserts.length; k += 6) {
      await (db as ReturnType<typeof drizzle>)
        .insert(cards)
        .values(inserts.slice(k, k + 6) as never)
        .onConflictDoNothing()
        .run();
    }
    console.log(`  chunk ${i / 50 + 1}/${Math.ceil(rows.length / 50)} (${chunk.length})`);
  }
  console.log("Seed lokal selesai");
}

async function seedRemote(rows: Array<{ front: string; back: string; category: string }>) {
  console.log(`Remote API: ${API_URL}/mcp`);
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const res = await fetch(`${API_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now() + i,
        method: "tools/call",
        params: { name: "import_cards", arguments: { cards: chunk, format: "json" } },
      }),
    });
    const j = (await res.json()) as { result?: { content?: Array<{ text: string }>; isError?: boolean } };
    if (j.result && "isError" in j.result && j.result.isError) throw new Error(`Remote seed gagal chunk ${i}: ${JSON.stringify(j)}`);
    console.log(`  chunk ${i / 50 + 1}/${Math.ceil(rows.length / 50)} OK`);
  }
  console.log("Seed remote selesai");
}

const allRows = loadAll();
console.log(`Seeder: ${allRows.length} total — ${Object.entries(allRows.reduce((a, r) => ((a[r.category] = (a[r.category] || 0) + 1), a), {} as Record<string, number>)).map(([k, v]) => `${k}:${v}`).join(", ")}`);

if (import.meta.url === `file://${process.argv[1]}`) {
  if (isRemote) await seedRemote(allRows);
  else await seedLocal(allRows);
}
