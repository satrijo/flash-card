# Flashcard SRS App 🚀

Aplikasi flashcard _offline-first_ modern berbasis Spaced Repetition System (SRS) dengan **kategori general-purpose**. Dibangun menggunakan ekosistem Cloudflare dan algoritma FSRS — bisa untuk bahasa (inggris, jepang, korea, jerman) maupun bidang lain (matematika, fisika, GIS, dll) dengan desain Systems Architecture (dark, lime/purple).

## 🛠 Tech Stack

- **Frontend:** TanStack Start (React 19), TanStack Router (file-based, `validateSearch` untuk `?category=`), Tailwind CSS 4, Vite 8, WebGL radial effect layer (CSS gradient fallback)
- **Backend:** Hono `^4.13`, Cloudflare Workers, `hono/cors` + Hono RPC (`hc<AppType>`), `drizzle-orm/batch`
- **Database (Cloud):** Cloudflare D1 (SQLite) via Drizzle ORM `1.0.0-rc.4` — 14 kolom
- **Database (Local/Offline):** IndexedDB via Dexie.js `^4.4.5` (v3, index `category`) + `dexie-react-hooks`
- **SRS Engine:** `ts-fsrs` `^5.4.1` (client-side, `maximum_interval: 36500`, `createEmptyCard`)
- **Design:** Systems Architecture (Neuform) — dark `#050505`, surface `#4C4C4C`, primary `#C7F300` lime, secondary `#4330C2` purple, Inter 64px display + JetBrains Mono 12px label, rounded 8px
- **Monorepo:** pnpm workspaces (`pnpm@10.30.1`)

## 📁 Struktur Monorepo

```
apps/
  web/
    src/routes/__root.tsx       # Shell dark, glow effect, nav mono uppercase, mount useSyncWorker
    src/routes/index.tsx        # Hero "Structure dictates function." (64px) → bento pills → grid → create form
    src/routes/review.tsx       # /review?category= → filtered due cards, lime progress bar, empty/completed dark
    src/components/ReviewCard.tsx # Dark flip card, category badge mono, 4 rating (rose/amber/emerald/blue)
    src/lib/db.ts               # Dexie "FlashcardDB" v3 (cards: id, due, category + syncQueue typed)
    src/lib/api.ts              # hc<AppType>(VITE_API_URL || localhost:8787)
    src/hooks/useSyncWorker.ts  # Poll 10s + online → POST /api/sync → bulkDelete
    src/styles.css              # @theme tokens, shimmer, hover-lift, masked-reveal, staggered
  api/
    src/index.ts                # GET/POST /api/cards (category), POST /api/sync (9 FSRS + optional category, db.batch), GET /api/hello
    wrangler.jsonc              # D1 binding DB → flashcard_db, migrations ../../packages/db/migrations
packages/
  db/
    index.ts                    # cards: id, front, back, category (default "general"), due, stability, difficulty, state, elapsed_days, scheduled_days, reps, lapses, last_review, createdAt (14 kolom)
    drizzle.config.ts           # dialect sqlite
    migrations/                 # 20260821030304_strong_skaar, 20260821035659_large_quentin_quire, 20260821044020_robust_morg (6 ADD COLUMN FSRS), 20260821060345_flawless_starbolt (category)
  shared/
    index.ts                    # fsrsEngine, Rating, FSRSCard, createEmptyCard
```

### Skema `cards` (D1 & Dexie sinkron, 14 kolom)

| Kolom | Tipe D1 | Kategori |
|---|---|---|
| `id` | `text` PK | `crypto.randomUUID()` |
| `front` / `back` | `text` | Konten kartu |
| `category` | `text` default `"general"` | `general` / `inggris` / `jepang` / `korea` / `jerman` / `matematika` / `fisika` / `gis` / custom — bebas, indexed `category` di Dexie untuk filter |
| `due` | `integer` timestamp | Jadwal berikutnya |
| `stability` / `difficulty` | `real` | FSRS |
| `state` | `integer` | 0 New / 1 Learning / 2 Review / 3 Relearning |
| `elapsed_days` / `scheduled_days` | `real` | FSRS |
| `reps` / `lapses` | `integer` | Hitungan |
| `last_review` | `integer` timestamp nullable | Terakhir |
| `created_at` | `integer` timestamp | `strftime('%s','now')` |

Dexie `LocalCard extends FSRSCard { id, front, back, category }`; `syncQueue` menyimpan `SyncAction { action: "REVIEW_CARD", payload: { id, nextState, category? } }` (typed, optional category untuk future edit).

### Desain (Systems Architecture)

- **Background** `#050505`, **surface** `#4C4C4C` / `#0a0a0a`, **primary** `#C7F300` lime (CTA, progress, due dot), **secondary** `#4330C2` purple (badge kategori), `text-primary` `#FFFFFF`, `text-secondary` `#A1A1AA`, `border` `#4C4C4C`
- **Typography:** display-lg Inter 64px/500 1.04 untuk hero (`Structure dictates function.`), body-md Inter 16px, label-md JetBrains Mono 12px/600 uppercase untuk badge/pill/metadata
- **Rounded** `8px` card/control, `9999px` pill, **spacing** 8/16/24/80, hover-lift + masked-reveal + stagger, WebGL glow radial di belakang konten

## 🚀 Cara Menjalankan

### Prasyarat

- Node.js `v18+`, pnpm `v10+` (WAJIB), Wrangler

### Instalasi

```bash
pnpm install
pnpm --filter @flashcard/db run db:generate   # jika ubah schema
pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local
```

### Dev

```bash
pnpm dev                                      # paralel api:8787 + web:3000
# atau
pnpm --filter @flashcard/api run dev
pnpm --filter web run dev
pnpm --filter web run generate-routes         # setelah ubah routes
```

### Deploy

```bash
pnpm --filter web run build && pnpm --filter web run deploy
pnpm --filter @flashcard/api run deploy
```

## 🔄 Alur Offline-First dengan Kategori

```
Create (Home inline form):
  front/back/category (datalist DEFAULT_CATEGORIES + custom) → createEmptyCard() → db.cards.add({ id, front, back, category, ...emptyCard, due: now, last_review: undefined }) — hanya Dexie, offline-first, no fetch

Review di /review?category=matematika (optional):
  fsrsEngine.repeat(card, now) → preview interval dinamis
  → db.transaction("rw", db.cards, db.syncQueue):
       db.cards.update(id, { due, state, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review })
       db.syncQueue.add({ action:"REVIEW_CARD", payload:{ id, nextState, category? } })
  → useSyncWorker (di __root.tsx, poll 10s + online):
       toArray → POST /api/sync { actions } via hc<AppType>
       → api: setData 9 FSRS + if payload.category → setData.category → db.batch(batchUpdates)
       → bulkDelete

Home bento:
  categories = union(DEFAULT_CATEGORIES + from db.cards) sorted general first
  pill "All" + pills per category (lime active #C7F300) → filter grid + dueCount per category
  card badge mono 12px purple #4330C2 + due pulse dot lime jika due <= now
  link card → /review?category=...

Pull: Home Sync → GET /api/cards → bulkPut (termasuk category)
```

### Rute Frontend

| Rute | Fungsi |
|---|---|
| `/` | Hero 64px + stat panel (total/due/categories/retained) → create form → bento pills (dueCount) → grid 2-col filtered + badge + due indicator |
| `/review?category=` | `where("due").below(now).sortBy("due")` + filter category jika param ada, progress lime di track #4C4C4C, ReviewCard flip dark, empty/completed dark state |

### API

| Method | Path | Body |
|---|---|---|
| `GET` | `/api/cards` | → semua kartu (termasuk category) |
| `POST` | `/api/cards` | `{ front, back, category?: string }` → `category: trim() || "general"` |
| `POST` | `/api/sync` | `{ actions: { id, nextState, category? }[] }` → `eq` + `Partial<inferInsert>` + conditional `category` → `db.batch` |
| `GET` | `/api/hello` | health |

## 🛡️ Aturan Penting

- pnpm only, strict TS, `hc<AppType>` (no fetch manual)
- Semua mutasi → Dexie v3 (`category` indexed), tidak langsung API
- FSRS client via `createEmptyCard` + 9 field
- `useSyncWorker` di `__root.tsx` global
- `POST /api/sync` WAJIB `db.batch()` (bukan loop)
- Schema → `packages/db/index.ts` → `db:generate` → `wrangler apply`
- Kategori: free-form string, default `general`, `DEFAULT_CATEGORIES` di Home sebagai seed, custom via input + datalist, filter via bento pills

## 🤖 MCP Server — AI Card Management

Server MCP (Model Context Protocol) berbasis stdio untuk manajemen kartu flashcard via AI. Terletak di `packages/mcp`, menyediakan **13 tools** yang memungkinkan AI membuat, mengedit, menghapus, mereview, dan mengekspor kartu tanpa perlu UI.

### Quickstart

```bash
# Build (compile TypeScript ke dist/)
pnpm --filter @flashcard/mcp run build

# Dev (langsung dari source via tsx, no build)
pnpm --filter @flashcard/mcp run dev

# Jalankan hasil build
node packages/mcp/dist/index.js
```

**opencode** sudah auto-discover via `opencode.jsonc` di root repo (entry `mcp.flashcard`). Cek dengan `opencode mcp list` — harus muncul `flashcard` dengan status connected.

**Claude Desktop**: salin `packages/mcp/claude_desktop_config.example.json` ke:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Sesuaikan path absolut `dist/index.js` jika perlu.

### Daftar Tool (13)

| Tool | Deskripsi | Param Utama |
|---|---|---|
| `ping` | Health check, mengembalikan `"pong"` | — |
| `list_cards` | Daftar kartu dengan filter kategori, status due, pencarian teks, pagination, sorting | `category?`, `dueStatus?` (all/due/new), `search?`, `limit` (1-100, default 20), `offset`, `sortBy` (due/createdAt/front), `sortOrder` (asc/desc) |
| `get_card` | Ambil satu kartu berdasarkan id | `id` (required) |
| `create_card` | Buat kartu baru (FSRS defaults via `createEmptyCard`) | `front` (required), `back` (required), `category?` |
| `update_card` | Update front/back/category/due kartu yang ada | `id` (required), `front?`, `back?`, `category?`, `due?` (ISO string) |
| `delete_card` | Hapus kartu berdasarkan id | `id` (required) |
| `bulk_create_cards` | Buat banyak kartu sekaligus (maks 50) dalam satu insert | `cards[]` (array `{front, back, category?}`, min 1, max 50) |
| `list_categories` | Daftar kategori beserta jumlah kartu dan jumlah due per kategori | `includeCounts?` (boolean, default true) |
| `get_stats` | Statistik: total, due, new, jumlah kategori, retention, breakdown per kategori | `category?` |
| `search_cards` | Cari kartu berdasarkan teks pada front/back (LIKE), opsional filter kategori | `query` (required), `category?`, `limit` (1-50, default 10) |
| `review_card` | Simulasikan review FSRS: beri rating, hitung nextState via `fsrsEngine`, persist 9 field FSRS | `id` (required), `rating` (again/hard/good/easy) |
| `import_cards` | Import banyak kartu sekaligus (maks 100) dalam satu insert bulk | `cards[]` (array `{front, back, category?}`, min 1, max 100), `format?` (json, default json) |
| `export_cards` | Ekspor kartu (semua atau per kategori) dalam format JSON atau CSV | `category?`, `format?` (json/csv, default json) |

### Environment & DB_PATH

Server MCP menggunakan `better-sqlite3` untuk akses langsung ke database SQLite lokal. Resolusi `DB_PATH` (di `createDb()` pada `packages/mcp/src/index.ts`):

1. **`DB_PATH` env** — override eksplisit, contoh: `DB_PATH=/tmp/test.db`
2. **Auto-discovery wrangler D1** — glob `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (file dengan mtime terbaru). Dibuat oleh:
   ```bash
   pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local
   ```
   Jika `.wrangler/state` belum ada, jalankan perintah di atas dulu agar DB tools memakai data lokal yang benar.
3. **`packages/db/flashcard.db`** — fallback file lokal jika ada.
4. **`:memory:`** — fallback terakhir (untuk test / tanpa DB lokal). `tools/list` tetap sukses; DB tools berjalan di DB kosong.

**`API_URL`** — reserved untuk future HTTP transport (server saat ini stdio-only). Aman di-set, tidak dibaca kode sekarang.

### Contoh Workflow AI

**1. AI buatin 10 kartu kosakata jepang kategori `jepang`**
```
→ bulk_create_cards({ cards: [{front: "食べる", back: "to eat", category: "jepang"}, ...] })
```

**2. Hapus semua kartu `gis` yang sudah tidak dipakai**
```
→ search_cards({ query: "", category: "gis" })  // ambil semua kartu gis
→ delete_card({ id: "..." }) untuk setiap kartu yang ingin dihapus
```

**3. Review kartu yang due sekarang**
```
→ list_cards({ dueStatus: "due", limit: 10 })
→ review_card({ id: "<card_id>", rating: "good" })  // untuk setiap kartu yang di-review
```

**4. Export semua kartu `matematika` ke CSV**
```
→ export_cards({ category: "matematika", format: "csv" })
```

### Ide Pengembangan

- **`generate_cards` dari topik** — AI generate kartu dari prompt (misal "generate 20 kartu tentang kalkulus dasar")
- **Duplicate detection** — cek kartu mirip sebelum create (berdasarkan front/back)
- **Quality check** — validasi front/back tidak kosong, kategori valid, format benar
- **Category suggestion via AI** — AI suggest kategori berdasarkan konten front/back
- **Import dari PDF/Anki** — parse file eksternal dan convert ke format flashcard

## 📄 Lisensi

ISC
