# Flashcard SRS App 🚀

Aplikasi flashcard _offline-first_ modern berbasis Spaced Repetition System (SRS) dengan **kategori general-purpose**. Dibangun menggunakan ekosistem Cloudflare dan algoritma FSRS — bisa untuk bahasa (inggris, jepang, korea, jerman) maupun bidang lain (matematika, fisika, GIS, dll) dengan desain Systems Architecture (dark, lime/purple).

## 🛠 Tech Stack

- **Frontend:** TanStack Start (React 19), TanStack Router (file-based, `validateSearch` untuk `?category=`), Tailwind CSS 4, Vite 8, WebGL radial effect layer (CSS gradient fallback)
- **Backend:** Hono `^4.13`, Cloudflare Workers, `hono/cors` + Hono RPC (`hc<AppType>`)
- **Database (Cloud):** Cloudflare D1 (SQLite) via Drizzle ORM `1.0.0-rc.4` — 15 kolom
- **Database (Local/Offline):** IndexedDB via Dexie.js `^4.4.5` (v7, index `category`, tanpa syncQueue — download-only) + `dexie-react-hooks`
- **SRS Engine:** `ts-fsrs` `^5.4.1` (client-side, `maximum_interval: 36500`, `createEmptyCard`)
- **Design:** Systems Architecture (Neuform) — dark `#050505`, surface `#4C4C4C`, primary `#C7F300` lime, secondary `#4330C2` purple, Inter 64px display + JetBrains Mono 12px label, rounded 8px
- **Monorepo:** pnpm workspaces (`pnpm@10.30.1`)

## 📁 Struktur Monorepo

```
apps/
  web/
    src/routes/__root.tsx       # Shell dark, glow effect, nav mono uppercase, mount useAutoSync
    src/routes/index.tsx        # Hero "Structure dictates function." (64px) → bento pills → grid → create form
    src/routes/review.tsx       # /review?category= → filtered due cards, lime progress bar, empty/completed dark
    src/routes/kelola.tsx       # /kelola → grid kartu + KelolaCardFormModal / KelolaCardItem / KelolaPagination
    src/routes/komunitas.tsx    # /komunitas → chat + Komunitas*Modal, hook useCommunityChat
    src/routes/pengaturan.tsx   # /pengaturan → PengaturanCloudSection / PengaturanDeckSection / PengaturanLocalBackupSection / PengaturanPreferensi
    src/components/ReviewCard.tsx # Dark flip card, category badge mono, 4 rating (rose/amber/emerald/blue)
    src/lib/db.ts               # Dexie "FlashcardDB" v7 (cards: id, due, category; gameStats; habitats; meta; communityMessages; practiceHistory) — tanpa syncQueue
    src/lib/sync.ts             # Download-only: checkAndUpdateDeck / runSync (GET /api/deck/version + /api/deck/cards, batch 100)
    src/lib/cloud/              # handle.ts / status.ts / upload.ts / download.ts / shared-deck.ts (backup R2 + import deck teman)
    src/lib/api.ts              # hc<AppType>(VITE_API_URL || localhost:8787)
    src/hooks/useAutoSync.ts    # Sekali saat onboarding (IndexedDB kosong) → runSync; tanpa background polling
    src/styles.css              # @theme tokens, shimmer, hover-lift, masked-reveal, staggered
  api/
    src/index.ts                # Composition root: CORS + route() + GET/POST /mcp
    src/routes/deck.ts          # GET /api/hello, /api/deck/version, /api/deck/cards, /api/user/check-handle, POST /api/user/claim-handle
    src/routes/community.ts     # WS /ws/community, GET/POST/DELETE /api/community/messages, POST /api/community/heartbeat
    src/routes/backup.ts        # POST/GET /api/backup/cloud, GET /api/backup/cloud/status (R2)
    src/mcp/tools.ts            # 13 MCP tools (CRUD/kategori/search/FSRS review/import/export)
    src/lib/deck-version.ts     # Hash FNV-1a deckVersion + cache
    src/lib/env.ts              # Bindings + getD1
    wrangler.jsonc              # D1 binding DB → flashcard_db, migrations ../../packages/db/migrations
packages/
  db/
    index.ts                    # cards: id, front, back, category (default "general"), due, stability, difficulty, state, elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review, createdAt (15 kolom)
    drizzle.config.ts           # dialect sqlite
    migrations/                 # 20260821030304_strong_skaar, 20260821035659_large_quentin_quire, 20260821044020_robust_morg (6 ADD COLUMN FSRS), 20260821060345_flawless_starbolt (category)
  shared/
    index.ts                    # fsrsEngine, Rating, FSRSCard, createEmptyCard, normalizeCategory, buildFsrsUpdate, FSRS_RATINGS, normalizeUserHandle, isReservedHandle
  mcp/
    src/index.ts                # MCP stdio server — 13 tools CRUD/kategori/search/FSRS review/import/export
    claude_desktop_config.example.json  # Snippet konfigurasi Claude Desktop
```

### Skema `cards` (D1 & Dexie sinkron, 15 kolom)

| Kolom | Tipe D1 | Kategori |
|---|---|---|
| `id` | `text` PK | `crypto.randomUUID()` |
| `front` / `back` | `text` | Konten kartu |
| `category` | `text` default `"general"` | **Pure dynamic** — kategori apa pun yang ada di kartu (mis. `inggris`, `jepang`, `matematika`, `fisika`, `gis`, atau custom bebas), indexed `category` di Dexie untuk filter bento |
| `due` | `integer` timestamp | Jadwal berikutnya |
| `stability` / `difficulty` | `real` | FSRS |
| `state` | `integer` | 0 New / 1 Learning / 2 Review / 3 Relearning |
| `elapsed_days` / `scheduled_days` | `real` | FSRS |
| `learning_steps` | `integer` | FSRS — langkah belajar saat ini |
| `reps` / `lapses` | `integer` | Hitungan |
| `last_review` | `integer` timestamp nullable | Terakhir |
| `created_at` | `integer` timestamp | `strftime('%s','now')` |

Dexie `LocalCard extends FSRSCard { id, front, back, category, createdAt, learning_steps }`; sync download-only — tidak ada `syncQueue`/`SyncAction` (dihapus di Dexie v5).

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

### Deploy ke Cloudflare (Production)

> Urutan wajib: **API dulu → Web**. Web butuh URL API saat build (`VITE_API_URL`).

#### 1. Login & buat D1 (sekali saja)

```bash
npx wrangler login
npx wrangler whoami
npx wrangler d1 create flashcard_db
# output: database_id = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Copy `database_id` tersebut → paste ke `apps/api/wrangler.jsonc` ganti `xxxx-xxxx-xxxx`:

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "flashcard_db", "database_id": "ID_ASLI_DISINI", "migrations_dir": "../../packages/db/migrations" }]
```

#### 2. Migrasi ke D1 Remote

```bash
pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --remote
pnpm --filter @flashcard/api exec wrangler d1 execute flashcard_db --remote --command "SELECT count(*) as total FROM cards"
```

#### 3. Deploy API

```bash
pnpm --filter @flashcard/api run deploy
# → https://api.<subdomain>.workers.dev
curl https://api.<subdomain>.workers.dev/api/hello
# {"message":"Hello from Cloudflare D1!"}
```

#### 4. Deploy Web (butuh URL API)

`VITE_API_URL` di-embed saat `vite build`, jadi harus di-set sebelum build:

```bash
VITE_API_URL="https://api.<subdomain>.workers.dev" pnpm --filter web run deploy
# = vite build + wrangler deploy → https://tanstack-start-app.<subdomain>.workers.dev
```

Atau dua langkah:

```bash
export VITE_API_URL="https://api.<subdomain>.workers.dev"
pnpm --filter web run build
pnpm --filter web exec wrangler deploy
```

> Lokal tetap pakai `http://localhost:8787` (fallback di `apps/web/src/lib/api.ts`). Tidak perlu set `VITE_API_URL` saat `pnpm dev`.

#### 5. Verifikasi

```bash
curl https://api.<subdomain>.workers.dev/api/cards | head
# buka https://tanstack-start-app.<subdomain>.workers.dev → buat kartu → review → sync harus hijau
```

#### Update / Rollback

```bash
# ada perubahan schema?
pnpm --filter @flashcard/db run db:generate
pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --remote
pnpm --filter @flashcard/api run deploy
VITE_API_URL="https://api.<subdomain>.workers.dev" pnpm --filter web run deploy

# rollback cepat
npx wrangler deployments list --name api
npx wrangler rollback --name api --deployment-id <ID>
```

#### Catatan

- **Custom domain:** Cloudflare Dashboard → Workers & Pages → `api` / `tanstack-start-app` → Settings → Triggers → Add Custom Domain.
- **Env lain:** `apps/api` tidak butuh secret sekarang; `apps/web` hanya `VITE_API_URL`. Jika butuh, set via `npx wrangler secret put KEY --name api` atau `vars` di `wrangler.jsonc`.
- **CI/CD:** Buat `.github/workflows/deploy.yml` yang jalan `pnpm install → d1 migrations apply --remote → deploy api → deploy web (dengan VITE_API_URL)`.
- **MCP (`packages/mcp`) tidak di-deploy** — stdio lokal saja (`pnpm --filter @flashcard/mcp run dev` via `opencode.jsonc`).

## 🔄 Alur Offline-First dengan Kategori

```
Create (Home inline form):
  front/back/category (input bebas + <datalist> kategori yang sudah ada) → createEmptyCard() → db.cards.add({ id, front, back, category, ...emptyCard, due: now, last_review: undefined }) — hanya Dexie, offline-first, no fetch

Review di /review?category=matematika (optional):
  fsrsEngine.repeat(card, now) → preview interval dinamis
  → buildFsrsUpdate(card, rating, now) → db.cards.update(id, nextState)
       10 field FSRS (termasuk learning_steps) — hanya Dexie, tanpa antrean, tanpa API call

Home bento:
  categories = pure dynamic (Set dari db.cards.category, "general" diprioritaskan di urutan pertama)
  pill "All" + pills per category (lime active #C7F300) → filter grid + dueCount per category
  card badge mono 12px purple #4330C2 + due pulse dot lime jika due <= now
  link card → /review?category=...

Pull deck (manual, Pengaturan): checkAndUpdateDeck / runSync → GET /api/deck/version → jika berubah, GET /api/deck/cards per batch 100 → bulkPut (kategori via normalizeCategory)
```

### Rute Frontend

| Rute | Fungsi |
|---|---|
| `/` | Hero 64px + stat panel (total/due/categories/retained) → create form → bento pills (dueCount) → grid 2-col filtered + badge + due indicator |
| `/review?category=` | `where("due").below(now).sortBy("due")` + filter category jika param ada, progress lime di track #4C4C4C, ReviewCard flip dark, empty/completed dark state |

### API

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/hello` | health |
| `GET` | `/api/deck/version` | hash FNV-1a deck saat ini (`fnv1a-…`) |
| `GET` | `/api/deck/cards` | semua kartu deck referensi (batch 100 di client) |
| `GET` | `/api/user/check-handle` | cek ketersediaan handle `kata-<nama>` |
| `POST` | `/api/user/claim-handle` | klaim handle unik |
| `GET` / `POST` | `/api/community/messages` | baca / kirim pesan komunitas |
| `DELETE` | `/api/community/messages/:id` | hapus pesan |
| `POST` | `/api/community/heartbeat` | presence & online count |
| `GET` | `/ws/community` | WebSocket chat komunitas (upgrade dari HTTP) |
| `POST` / `GET` | `/api/backup/cloud` | backup / restore deck ke R2 |
| `GET` | `/api/backup/cloud/status` | status backup terakhir |
| `GET` / `POST` | `/mcp` | JSON-RPC MCP (13 tools) |

Tidak ada `POST /api/cards` / `POST /api/sync` — sync download-only, semua tulis ke Dexie lokal.

## 🛡️ Aturan Penting

- pnpm only, strict TS, `hc<AppType>` (no fetch manual)
- Semua mutasi → Dexie v7 (`category` indexed), tidak langsung API
- FSRS client via `createEmptyCard` + `buildFsrsUpdate` (10 field, termasuk `learning_steps`)
- `useAutoSync` di `__root.tsx` — sekali saat onboarding, tanpa background polling
- Sync download-only: tidak ada `POST /api/sync`, `syncQueue`, atau `SyncAction` — jangan dihidupkan kembali
- Schema → `packages/db/index.ts` → `db:generate` → `wrangler apply`
- Kategori: **pure dynamic** — tidak ada daftar hardcode; kategori diturunkan dari `db.cards.category` yang ada, fallback `"general"` untuk kartu tanpa kategori, input bebas + `<datalist>` di `CreateCardForm`, filter via bento pills

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
| `review_card` | Simulasikan review FSRS: beri rating, hitung nextState via `buildFsrsUpdate`, persist 10 field FSRS | `id` (required), `rating` (again/hard/good/easy) |
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
