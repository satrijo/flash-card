# NOTES — Dunia User

## Konteks
- Proyek: flashcard SRS app (monorepo pnpm: `apps/web` TanStack Start + React 19, `apps/api` Hono di Cloudflare Workers + D1, `packages/db` Drizzle, `packages/shared` fsrsEngine, `packages/mcp`).
- User adalah SATU-SATUNYA penulis konten kartu. Authoring via **MCP** (`list_cards`, `create_card`, dll — invoke via opencode) dan seed CSV (`front`, `back`, `category`; QUOTE_ALL).
- Konsumen: dirinya sendiri + siapa pun yang buka web — semua memakai app **tanpa akun/login**.
- Akses utama: **PWA di HP** (browser, IndexedDB/Dexie `FlashcardDB`). Desktop sekunder.

## Fakta teknis yang sudah ada
- Kategori existing: `inggris-easy`, `inggris-medium`, `inggris-advance`, `inggris-native` — pure dynamic, tidak boleh ada daftar hardcode.
- FSRS via `ts-fsrs` (`fsrsEngine.repeat`) — kini berjalan **100% lokal**, server tidak tahu soal progress.
- Dexie v3 sekarang: `cards`, `syncQueue`, `gameStats` (single row id="user": xp, streakCount, streakLastDay, todayKey, todayCount, dailyGoal).
- Sudah ada `apps/web/src/lib/game.ts`: XP_PER_RATING (again 5 / hard 8 / good 10 / easy 15), level threshold `50*L*(L-1)`, day-roll streak lokal.
- Belum ada apa pun untuk PWA (manifest, icon, service worker) — dibuat dari nol.
- Tema kode saat ini: light "Ecosystem" orange (#E48B59). DESIGN.md asli lock dark+lime — akan diganti ke palet Light Playful baru.

## Kosakata kanonik (ganti istilah teknis di SELURUH UI)
| Istilah lama (dilarang tampil) | Istilah baru |
|---|---|
| category | **Habitat** |
| review / session | **Ekspedisi** |
| XP | **Koin** |
| streak | **Jejak Harian** (ikon 🐾, bukan 🔥) |
| due cards | **Kartu Siap** |
| daily goal | **Target Harian** |
| mastery % | **Kekuatan Habitat** |
| sync / cloud / server | tidak pernah disebut — sync terjadi sendiri |
| FSRS / IndexedDB / interval | tidak pernah disebut — tombol waktu saja |

Rank penjelajah per level (Indonesia, playful): L1 Pemula, L2 Penjelajah, L3 Pemandu, L4 Penakluk, L5 Legenda, L6+ Legenda ⭐n.

## Preferensi kerja user
- Bahasa chat: Indonesia; UI copy juga Indonesia.
- Instruksi pendek, langsung eksekusi, jangan bertanya berulang.
- Pecah pekerjaan besar jadi langkah kecil bertahap.
