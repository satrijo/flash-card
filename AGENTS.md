# AI Agent Guidelines for Flashcard SRS App

Proyek ini adalah monorepo _offline-first_ flashcard app. Ikuti aturan berikut dengan ketat saat menulis, memodifikasi, atau memberikan saran kode.

## 1. Arsitektur & Tooling

- **Package Manager:** WAJIB menggunakan `pnpm`. Jangan gunakan `npm` atau `yarn`.
- **Monorepo:** Menggunakan pnpm workspaces (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/mcp`).
- **Tipe Data:** Gunakan TypeScript secara ketat. Manfaatkan Hono RPC (`hc<AppType>`) di frontend untuk _type safety_ API, jangan tulis fetch manual atau mendefinisikan ulang _type_ respons API di frontend.
- **Route Generation:** Setelah menambah/mengubah file di `apps/web/src/routes/`, jalankan `pnpm --filter web run generate-routes` untuk regenerasi `routeTree.gen.ts`. Jangan edit file tersebut manual.
- **Design System:** Ikuti `DESIGN.md` (Systems Architecture: dark `#050505`, surface `#4C4C4C`, primary `#C7F300` lime, secondary `#4330C2` purple, Inter 64px display, JetBrains Mono 12px label, rounded 8px). Jaga palet primary/secondary tetap lock, jangan swap light/dark.

## 2. Frontend (`apps/web`)

- **Framework:** Menggunakan ekosistem TanStack (TanStack Start/Router dengan `validateSearch`) dan React 19.
- **Styling:** Gunakan Tailwind CSS 4 + `@theme` tokens dari `DESIGN.md`.
- **Offline-First:** Semua operasi baca/tulis data HARUS ke IndexedDB via **Dexie.js** (`apps/web/src/lib/db.ts`). UI tidak pernah POST ke API — creation via `db.cards.add(...)` lokal, `createEmptyCard()` dari `@flashcard/shared`. Upload ke cloud hanya lewat backup R2 (`createCloudBackup`, lihat §5).
- **Dexie Schema (v7):** `cards` (`id, due, category` indexed) menyimpan `LocalCard extends FSRSCard { id, front, back, category, createdAt, learning_steps }`; `gameStats` (`id`), `habitats` (`category`), `meta` (`key`), `communityMessages` (`id, timestamp`), `practiceHistory` (`++id, timestamp, tahap`). **Tidak ada `syncQueue`** — antrean upload dihapus di v5 (upgrade mengosongkannya); sync model download-only, lihat §5. Kategori **pure dynamic** (tidak ada daftar hardcode) — diturunkan dari kategori kartu yang ada, fallback `"general"`, custom via input bebas + `<datalist>`.
- **Sync saat startup:** `useAutoSync` WAJIB di-mount di `apps/web/src/routes/__root.tsx` (bukan page) — hanya berjalan sekali saat aplikasi pertama dibuka dan IndexedDB masih kosong (0 kartu & belum ada deckVersion). Hook ini TIDAK melakukan background polling (hemat kuota D1); pembaruan deck selanjutnya manual dari menu Pengaturan (`checkAndUpdateDeck` / `runSync` di `apps/web/src/lib/sync.ts`).
- **Rute:** `/` (hero `Structure dictates function.` 64px Inter → bento pill filter kategori (`All` + pills per kategori dengan dueCount) → grid 2-col + badge kategori mono + due pulse → inline `CreateCardForm` offline-first) dan `/review?category=` (validateSearch plain fn, query `db.cards.where("due").below(now).sortBy("due")` + filter `category` jika param ada, progress lime `#C7F300` di track `#4C4C4C`). Jangan buat rute tanpa query due yang benar.
- **Spaced Repetition:** Kalkulasi di client via `ts-fsrs` (`fsrsEngine`). Interval tombol `ReviewCard` WAJIB dinamis (`formatInterval` dari `fsrsEngine.repeat` preview), dilarang hard-code `5m/10m/4h`. Card surface `bg-[#0a0a0a]` border `#4C4C4C`, reveal button lime, rating rose/amber/emerald/blue.

## 3. Backend (`apps/api`)

- **Framework:** Hono di Cloudflare Workers.
- **Fokus:** Source of truth (deck + komunitas + backup) — **tidak ada endpoint upload review/sync**. Sync model download-only (lihat §5); `POST /api/cards` dan `POST /api/sync` **tidak ada**.
- **Struktur:** `src/index.ts` hanya composition root (CORS + `.route()`); logika per domain di `src/routes/deck.ts` (GET `/api/hello`, GET `/api/deck/version`, GET `/api/deck/cards`, GET `/api/user/check-handle`, POST `/api/user/claim-handle`), `src/routes/community.ts` (WS `/ws/community`, GET/POST/DELETE `/api/community/messages`, POST `/api/community/heartbeat`), `src/routes/backup.ts` (POST/GET `/api/backup/cloud`, GET `/api/backup/cloud/status`, R2 `BACKUP_BUCKET`), `src/mcp/tools.ts` (13 MCP tools, endpoint GET/POST `/mcp` di `index.ts`); util di `src/lib/` (`env.ts` = `Bindings` + `getD1`, `deck-version.ts` = hash FNV-1a + cache, `community.ts` = `initCommunityD1` + `verifyAdminKey`).
- **FSRS Review Contract:** review ditulis via `buildFsrsUpdate` dari `@flashcard/shared` — tepat **10 field** (`due, state, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review`). Parity wajib di tiga tempat: web `EkspedisiCard`, API `handleReviewCard`, MCP `reviewCard`. Kategori dinormalisasi via `normalizeCategory` (`trim()` + lowercase, kosong → `"general"`).

## 4. Database (`packages/db`)

- **ORM:** Drizzle ORM, D1 SQLite.
- **Schema Source-of-Truth:** `packages/db/index.ts` — tabel `cards` **15 kolom**: `id, front, back, category (default "general" notNull), due, stability, difficulty, state, elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review (nullable), createdAt`. `category` indexed di Dexie untuk filter bento.
- **Aturan Migrasi:** Ubah `packages/db/index.ts` → `pnpm --filter @flashcard/db run db:generate` → `pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local` (remote saat deploy). Migrasi terbaru: `20260821060345_flawless_starbolt` (`ALTER TABLE ADD category text DEFAULT 'general' NOT NULL`), sebelumnya `20260821044020_robust_morg` (6 FSRS ADD COLUMN).

## 5. Alur Sinkronisasi (Download-Only, Dexie v5+)

- **Model:** tidak ada upload review ke server. Semua tulis (buat kartu, review, edit, hapus) hanya ke Dexie lokal. Server hanya menyediakan deck referensi + backup cloud + komunitas.
- **Create:** `CreateCardForm` di Home (offline-first): `createEmptyCard()` → `db.cards.add({ id, front, back, category, ...emptyCard, due: now })` — no API, indexed `category`.
- **Review:** Di `/review?category=`, `buildFsrsUpdate(card, rating, now)` → `db.cards.update(id, nextState)` — 10 field FSRS, tanpa antrean, tanpa API call.
- **Pull deck (manual):** `checkAndUpdateDeck()` / `runSync()` di `apps/web/src/lib/sync.ts` — GET `/api/deck/version`, bandingkan dengan `deckVersion` lokal (meta); jika berubah, GET `/api/deck/cards` per batch 100 (`SYNC_BATCH_SIZE`), `normalizeCard` (kategori via `normalizeCategory`), `bulkPut`. `force: true` = download ulang seluruh deck tanpa cek versi. Offline + 0 kartu → `loadBundledSeed()` (seed bundel lokal).
- **Cloud backup (R2, dua arah otomatis):** `useCloudSync` di `__root.tsx` — pull (`performCloudPull`) saat mount, saat tab kembali visible, dan saat online kembali; bila merge mendeteksi lokal lebih baru (`hasLocalAhead`), `scheduleCloudPush(4000)` mengunggah dengan debounce (juga dipanggil tiap review). Manual dari Pengaturan: `createCloudBackup` (POST `/api/backup/cloud`) / `restoreCloudBackup` + `pullAndMergeCloudBackup` (GET `/api/backup/cloud`). Yang download-only adalah sync REVIEW (`POST /api/sync` tidak ada) — backup cloud adalah mekanisme terpisah yang membawa seluruh deck lokal.
- **Pull lama yang SUDAH TIDAK ADA:** `POST /api/sync`, `GET /api/cards`, `syncQueue`, `SyncAction`. Jangan dihidupkan kembali — bila menemukan sisa kode sync lama, laporkan, jangan dipakai.

## 6. Penamaan & Konvensi

- Workspace `@flashcard/db` dan `@flashcard/shared` via `workspace:*`.
- Review memakai `buildFsrsUpdate` dari `@flashcard/shared` (10 field FSRS, lihat §3) — jangan bangun objek FSRS manual di call site.
- Kategori: free-form `string`, lowercase, dilarang kosong — fallback `"general"`. UI tampilkan dengan JetBrains Mono 12px/600 uppercase badge `bg-[#4330C2]`.
- Semua TS strict, tanpa `as any` / `@ts-ignore`. Validasi `front/back` trim required, kategori via `normalizeCategory` (trim + lowercase, kosong → `"general"`).

## 7. MCP Server (`packages/mcp`)

- **Kapan Pakai MCP vs Edit DB Langsung:** AI WAJIB menggunakan MCP tools untuk semua operasi kartu (create, read, update, delete, review, import, export). Jangan edit database langsung via SQL atau Drizzle dari luar MCP. MCP menyediakan validasi, FSRS integration, dan audit trail yang konsisten.
- **Tool Naming:** Semua tool menggunakan `snake_case` (`list_cards`, `create_card`, `review_card`, dll). Setiap tool punya zod schema untuk validasi input. Jangan bypass validasi dengan `as any` atau skip schema parsing.
- **Category Handling:** Kategori selalu dinormalisasi via `normalizeCategory` (`trim()` + lowercase, kosong → `"general"`), pure dynamic (tidak ada `DEFAULT_CATEGORIES` hardcoded di MCP). MCP membaca kategori dari database secara real-time via `list_categories`.
- **FSRS Review via MCP:** Tool `review_card` menerima `rating` (`again`/`hard`/`good`/`easy`), mapping ke `Rating.Again`/`Hard`/`Good`/`Easy` dari `@flashcard/shared`, lalu memanggil `buildFsrsUpdate` dari `@flashcard/shared` dan persist 10 field FSRS (`due, state, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review`). Parity dengan web's `ReviewCard` dan API's `handleReviewCard`.
- **Security & Validasi:**
  - `front` dan `back` WAJIB `trim().min(1)` — tidak boleh kosong.
  - `bulk_create_cards` max 50 kartu, `import_cards` max 100 kartu — batasan untuk performa dan safety.
  - Semua input divalidasi via zod schema. Dilarang `as any` atau `@ts-ignore`.
  - Kategori optional di input, dinormalisasi via `normalizeCategory` (kosong setelah trim → `"general"`).
- **Cara Invoke:** AI invoke via `opencode mcp` (sudah wired di `opencode.jsonc` root). Jangan manual fetch ke API atau bypass MCP. Opencode auto-discover server via config `mcp.flashcard` dengan command `pnpm --filter @flashcard/mcp run dev`.
- **Environment & DB:**
  - `DB_PATH` auto-discovery: env > wrangler D1 (`.wrangler/state/v3/d1/miniflare-*.sqlite` newest) > `packages/db/flashcard.db` > `:memory:`.
  - Jika `.wrangler/state` belum ada, jalankan `pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local` dulu.
  - **Catatan Node 24:** `better-sqlite3` 9.6.0 punya ABI mismatch di Node 24 (environment saat ini). DB-backed tools gagal di sini, tapi `tools/list` sukses (tidak akses DB). Ini isu environment yang sudah diketahui, bukan bug konfigurasi. Gunakan Node 22 atau rebuild `better-sqlite3` jika perlu DB tools berfungsi di Node 24.
