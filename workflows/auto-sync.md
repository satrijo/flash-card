# Workflow: Deck Sync (Initial Download + Manual On-Demand)

Satu-satunya jalur data antara server dan device untuk kosakata kartu. Server = perpustakaan kartu read-only bersama; semua progress belajar hidup dan mati di IndexedDB perangkat masing-masing.

## Keputusan terkunci
1. **Arah:** download-only. Tidak ada upload progres FSRS ke server (kecuali fitur eksplisit Cadangan Cloud pengguna).
2. **Tanpa Polling Latar Belakang:** Tidak ada background polling berkala saat buka app, ganti tab (`visibilitychange`), atau online reconnect. Hal ini mencegah lonjakan kuota *row reads* Cloudflare D1.
3. **Inisialisasi Pertama (Initial Sync):** Saat pengguna pertama kali membuka app dan IndexedDB masih kosong (`cardCount === 0` & `meta.deckVersion` belum ada), aplikasi mengunduh deck awal (atau memuat seed offline). Begitu selesai, auto-sync tidak lagi terpanggil.
4. **Pembaruan Manual (On-Demand di Pengaturan):** Pembaruan kosakata dari D1 dilakukan secara manual melalui halaman `/pengaturan` -> "Koleksi Kosakata":
   - **Periksa Pembaruan Kosakata:** Mengontak `GET /api/deck/version`. Jika versi sama → langsung beri tahu pengguna bahwa data sudah up-to-date. Jika versi beda → unduh kartu baru/terupdate secara batched.
   - **Unduh Ulang Semua Kata (Paksa):** Mengunduh ulang seluruh kartu dari awal (`force: true`).
5. **Transfer:** batched download via `GET /api/deck/cards?offset=N&limit=100`. Client loop sampai habis, tulis `bulkPut` ke Dexie per batch, update progress tiap batch dengan mempertahankan progres FSRS lokal.

## Kontrak endpoint API
- `GET /api/deck/version` → `200 { version: string, count: number }`
  - `version`: hash FNV-1a atas seluruh baris cards (di-sort by id).
  - `count`: jumlah kartu.
- `GET /api/deck/cards?offset=<int>&limit=<int>` → `200 { cards: Card[], hasMore: boolean }`
  - Urut stabil by `id`. `limit` max 200.

## Alur Klien

```
Akses Pertama Kali (cardCount === 0)
  ├─ Onboarding Gate (SyncGate)
  │    ├─ Online  ──> Download deck awal (/api/deck/cards) ──> Simpan deckVersion ──> Siap belajar
  │    └─ Offline ──> Muat offline seed (/seed-deck.json) ──> Siap belajar

Kunjungan Rutin Berikutnya (cardCount > 0)
  └─ Buka langsung instan dari IndexedDB lokal (0 request ke server D1)

Pembaruan Kosakata (Manual di /pengaturan)
  └─ Klik "Periksa Pembaruan Kosakata"
       ├─ Offline ──> Notifikasi sambungkan internet
       ├─ Online  ──> GET /api/deck/version
       │                ├─ Versi sama  ──> Notifikasi "Kosakata sudah versi terbaru"
       │                └─ Versi beda  ──> Download batch kartu baru ──> Notifikasi sukses
```

## Dexie Tambahan
Tabel `meta` (v4): `{ key: string, value: unknown }` — simpan `deckVersion`, `lastSyncAt`.

