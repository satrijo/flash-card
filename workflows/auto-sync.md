# Workflow: Auto-Sync Top-Down (Download-Only)

Satu-satunya jalur data antara server dan device. Server = perpustakaan kartu read-only bersama; semua progress belajar hidup dan mati di IndexedDB perangkat masing-masing.

## Keputusan terkunci
1. **Arah:** download-only. Tidak ada upload, tidak pernah ada. `syncQueue`, jalur upload `useSyncWorker`, dan endpoint `POST /api/sync` DIHAPUS dari web app.
2. **Deteksi perubahan:** version-check. Endpoint ringan `GET /api/deck/version` mengembalikan `{ version: string, count: number }` di mana `version` = hash stabil dari seluruh isi tabel cards (dihitung server-side tiap request, tanpa state). Client bandingkan dengan `meta.deckVersion` lokal — sama = skip total; beda / belum ada = download.
3. **Transfer:** batched download. Endpoint `GET /api/deck/cards?offset=N&limit=100`. Client loop sampai habis, tulis `bulkPut` ke Dexie per batch, update progress tiap batch.
4. **UX:** hybrid gate.
   - First visit (`meta.deckVersion` kosong): layar penuh "menyiapkan petualangan" dengan progress bar kartu-per-kartu ("523/2140"), app tidak bisa dipakai sebelum selesai. Bagian dari onboarding gamifikasi.
   - Kunjungan berikutnya: version check senyap di background saat mount root. Beda versi → download senyap + toast kecil "Habitat baru tiba!" (tidak memblokir).
   - Offline (`!navigator.onLine`): skip sync, app jalan normal penuh dari cache.
5. **Multi-user tanpa akun:** tidak ada login, tidak ada identitas. Semua orang download deck yang sama; progress murni per-device.

## Kontrak endpoint API (satu-satunya yang tersisa)
- `GET /api/deck/version` → `200 { version: string, count: number }`
  - `version`: hash deterministik atas seluruh baris cards (misal FNV/djb2 atas id+front+back+category semua kartu, di-sort by id agar stabil). Boleh di-cache pendek di worker.
  - `count`: jumlah kartu (untuk estimasi progress).
- `GET /api/deck/cards?offset=<int>&limit=<int>` → `200 { cards: Card[], hasMore: boolean }`
  - Urut stabil by `id`. `limit` max 200.
  - `Card` = 14 kolom schema D1 yang sudah ada (id, front, back, category, due, stability, difficulty, state, elapsed_days, scheduled_days, reps, lapses, last_review, createdAt) + category selalu dinormalisasi `"general"` fallback.
- Endpoint lama `POST /api/cards` dan `POST /api/sync` dihapus.

## Alur client
```
mount __root.tsx
  ├─ navigator.onLine? ── no → done (offline mode)
  ▼ yes
GET /api/deck/version
  ├─ version === meta.deckVersion → done
  ▼ beda / pertama kali
first visit? ── yes → FULLSCREEN GATE (progress bar)
  │                        │
  │  no                    ▼
  ▼                   loop: GET /api/deck/cards?offset&limit=100
BACKGROUND SILENT          → bulkPut batch → progress++ 
  │                        → sampai hasMore=false
  ▼                        → meta.deckVersion = version
toast "Habitat baru!"      → gate tutup
```

## Dexie tambahan
Tabel `meta` (v4): `{ key: string, value: unknown }` — simpan `deckVersion`, `lastSyncAt`.

## Definisi selesai
- Buka web pertama kali → gate full-screen dengan angka progresi nyata → selesai → app terisi kartu.
- Refresh kedua → tidak ada download kartu (hanya 1 request version check yang match).
- Ubah kartu via MCP → buka app → download senyap + toast.
- Mode pesawat → app tetap berfungsi 100% untuk review.
