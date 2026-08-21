# AI Agent Guidelines for Flashcard SRS App

Proyek ini adalah monorepo _offline-first_ flashcard app. Ikuti aturan berikut dengan ketat saat menulis, memodifikasi, atau memberikan saran kode.

## 1. Arsitektur & Tooling

- **Package Manager:** WAJIB menggunakan `pnpm`. Jangan gunakan `npm` atau `yarn`.
- **Monorepo:** Menggunakan pnpm workspaces (`apps/web`, `apps/api`, `packages/db`, `packages/shared`).
- **Tipe Data:** Gunakan TypeScript secara ketat. Manfaatkan Hono RPC (`hc<AppType>`) di frontend untuk _type safety_ API, jangan tulis fetch manual atau mendefinisikan ulang _type_ respons API di frontend.
- **Route Generation:** Setelah menambah/mengubah file di `apps/web/src/routes/`, jalankan `pnpm --filter web run generate-routes` untuk regenerasi `routeTree.gen.ts`. Jangan edit file tersebut manual.
- **Design System:** Ikuti `DESIGN.md` (Systems Architecture: dark `#050505`, surface `#4C4C4C`, primary `#C7F300` lime, secondary `#4330C2` purple, Inter 64px display, JetBrains Mono 12px label, rounded 8px). Jaga palet primary/secondary tetap lock, jangan swap light/dark.

## 2. Frontend (`apps/web`)

- **Framework:** Menggunakan ekosistem TanStack (TanStack Start/Router dengan `validateSearch`) dan React 19.
- **Styling:** Gunakan Tailwind CSS 4 + `@theme` tokens dari `DESIGN.md`.
- **Offline-First:** Semua operasi baca/tulis data HARUS ke IndexedDB via **Dexie.js** (`apps/web/src/lib/db.ts`). UI tidak boleh langsung `POST /api/cards` — creation via `db.cards.add(...)` lokal, `createEmptyCard()` dari `@flashcard/shared`.
- **Dexie Schema:** `cards` (`id, due, category` indexed, v3) menyimpan `LocalCard extends FSRSCard { id, front, back, category }`; `syncQueue` (`++id`) menyimpan `SyncAction { action: "REVIEW_CARD", payload: { id: string, nextState: FSRSCard, category?: string } }` — `payload` WAJIB typed, dilarang `any`. Kategori default `"general"`, bebas: `inggris, jepang, korea, jerman, matematika, fisika, gis` + custom via `<datalist>`.
- **Global Sync Worker:** `useSyncWorker` WAJIB di-mount di `apps/web/src/routes/__root.tsx` (bukan page) — polling 10s + `online` event, guard `navigator.onLine`.
- **Rute:** `/` (hero `Structure dictates function.` 64px Inter → bento pill filter kategori (`All` + pills per kategori dengan dueCount) → grid 2-col + badge kategori mono + due pulse → inline `CreateCardForm` offline-first) dan `/review?category=` (validateSearch plain fn, query `db.cards.where("due").below(now).sortBy("due")` + filter `category` jika param ada, progress lime `#C7F300` di track `#4C4C4C`). Jangan buat rute tanpa query due yang benar.
- **Spaced Repetition:** Kalkulasi di client via `ts-fsrs` (`fsrsEngine`). Interval tombol `ReviewCard` WAJIB dinamis (`formatInterval` dari `fsrsEngine.repeat` preview), dilarang hard-code `5m/10m/4h`. Card surface `bg-[#0a0a0a]` border `#4C4C4C`, reveal button lime, rating rose/amber/emerald/blue.

## 3. Backend (`apps/api`)

- **Framework:** Hono di Cloudflare Workers.
- **Fokus:** Source of truth + batch sync.
- **Performa:** `POST /api/cards` terima `{ front, back, category? }` → `category: trim() || "general"` ke D1. `POST /api/sync` WAJIB import `eq` dari `drizzle-orm` + `BatchItem` dari `drizzle-orm/batch` untuk `where(eq(cards.id, id))`.
- **Sync Handler Contract:** Terima `{ actions: SyncAction[] }`, bangun `Partial<typeof cards.$inferInsert>` dengan 9 field FSRS (`due, state, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review`) + conditional `if (payload.category) setData.category = payload.category`, kumpulkan `db.update(cards).set(setData).where(eq(cards.id, id))` lalu `db.batch(batchUpdates as [BatchItem<"sqlite">, ...])`. Dilarang `await` per-row. Harus parity 9 field + optional category.

## 4. Database (`packages/db`)

- **ORM:** Drizzle ORM, D1 SQLite.
- **Schema Source-of-Truth:** `packages/db/index.ts` — tabel `cards` **14 kolom**: `id, front, back, category (default "general" notNull), due, stability, difficulty, state, elapsed_days, scheduled_days, reps, lapses, last_review (nullable), createdAt`. `category` indexed di Dexie untuk filter bento.
- **Aturan Migrasi:** Ubah `packages/db/index.ts` → `pnpm --filter @flashcard/db run db:generate` → `pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local` (remote saat deploy). Migrasi terbaru: `20260821060345_flawless_starbolt` (`ALTER TABLE ADD category text DEFAULT 'general' NOT NULL`), sebelumnya `20260821044020_robust_morg` (6 FSRS ADD COLUMN).

## 5. Alur Sinkronisasi (Sync Queue Rule)

- **Create:** `CreateCardForm` di Home (offline-first): `createEmptyCard()` → `db.cards.add({ id, front, back, category, ...emptyCard, due: now })` — no API, indexed `category`.
- **Review:** Di `/review?category=`, transaksi atomik `db.transaction("rw", db.cards, db.syncQueue, ...)` — `db.cards.update` 9 field + `db.syncQueue.add({ action:"REVIEW_CARD", payload:{ id, nextState, category? } })`.
- **Background:** `useSyncWorker` di `__root.tsx` → `toArray()` → `POST /api/sync` via `hc<AppType>` → `bulkDelete` saat `res.ok`. Polling 10s + `online`.
- **Pull:** `GET /api/cards` → `bulkPut` (termasuk `category`). `useLiveQuery` reaktif, `DEFAULT_CATEGORIES` (`general, inggris, jepang, korea, jerman, matematika, fisika, gis`) digabung dengan kategori dari DB untuk pill filter.

## 6. Penamaan & Konvensi

- Workspace `@flashcard/db` dan `@flashcard/shared` via `workspace:*`.
- `SyncAction` ada di `apps/web/src/lib/db.ts` dan dikonsumsi `apps/api/src/index.ts` — payload `{ id, nextState: FSRSCard, category? }`, category optional untuk future edit, review tetap tanpa category di nextState.
- Kategori: free-form `string`, lowercase, dilarang kosong — fallback `"general"`. UI tampilkan dengan JetBrains Mono 12px/600 uppercase badge `bg-[#4330C2]`.
- Semua TS strict, tanpa `as any` / `@ts-ignore`. Validasi `front/back` trim required, `category` trim || `"general"`.

## 7. MCP Server (`packages/mcp`)

- **Kapan Pakai MCP vs Edit DB Langsung:** AI WAJIB menggunakan MCP tools untuk semua operasi kartu (create, read, update, delete, review, import, export). Jangan edit database langsung via SQL atau Drizzle dari luar MCP. MCP menyediakan validasi, FSRS integration, dan audit trail yang konsisten.
- **Tool Naming:** Semua tool menggunakan `snake_case` (`list_cards`, `create_card`, `review_card`, dll). Setiap tool punya zod schema untuk validasi input. Jangan bypass validasi dengan `as any` atau skip schema parsing.
- **Category Handling:** Kategori selalu dinormalisasi: `trim() || "general"`, lowercase, pure dynamic (tidak ada `DEFAULT_CATEGORIES` hardcoded di MCP). MCP membaca kategori dari database secara real-time via `list_categories`.
- **FSRS Review via MCP:** Tool `review_card` menerima `rating` (`again`/`hard`/`good`/`easy`), mapping ke `Rating.Again`/`Hard`/`Good`/`Easy` dari `@flashcard/shared`, lalu memanggil `fsrsEngine.repeat(card, now)` dan persist 9 field FSRS (`due, state, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review`). Parity dengan web's `ReviewCard` dan API's `/api/sync`.
- **Security & Validasi:**
  - `front` dan `back` WAJIB `trim().min(1)` — tidak boleh kosong.
  - `bulk_create_cards` max 50 kartu, `import_cards` max 100 kartu — batasan untuk performa dan safety.
  - Semua input divalidasi via zod schema. Dilarang `as any` atau `@ts-ignore`.
  - Kategori optional di input, fallback `"general"` jika kosong setelah trim.
- **Cara Invoke:** AI invoke via `opencode mcp` (sudah wired di `opencode.jsonc` root). Jangan manual fetch ke API atau bypass MCP. Opencode auto-discover server via config `mcp.flashcard` dengan command `pnpm --filter @flashcard/mcp run dev`.
- **Environment & DB:**
  - `DB_PATH` auto-discovery: env > wrangler D1 (`.wrangler/state/v3/d1/miniflare-*.sqlite` newest) > `packages/db/flashcard.db` > `:memory:`.
  - Jika `.wrangler/state` belum ada, jalankan `pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local` dulu.
  - **Catatan Node 24:** `better-sqlite3` 9.6.0 punya ABI mismatch di Node 24 (environment saat ini). DB-backed tools gagal di sini, tapi `tools/list` sukses (tidak akses DB). Ini isu environment yang sudah diketahui, bukan bug konfigurasi. Gunakan Node 22 atau rebuild `better-sqlite3` jika perlu DB tools berfungsi di Node 24.
