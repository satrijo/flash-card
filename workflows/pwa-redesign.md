# Workflow: PWA Mobile-First + Redesign Light Playful Safari

## Keputusan terkunci

### PWA
1. Installable PWA untuk HP: Web App Manifest + service worker, dibuat dari nol (belum ada aset sama sekali).
2. `manifest.webmanifest`: `name` "Safari Kata" (nama app final bisa diganti user), `display: "standalone"`, `orientation: "portrait"`, `theme_color` & `background_color` = warna krem/tema Light Playful, icon 192 + 512 (maskable + any) — icon dibuat sebagai SVG→PNG sederhana bertema petualangan (kompas/daun).
3. Service worker (`vite-plugin-pwa` dengan TanStack Start/Vite yang sudah ada):
   - Precache shell app.
   - **Network-first untuk API deck**, **cache-first untuk aset statis**.
   - IndexedDB adalah source of truth data — SW hanya memastikan shell app bisa dibuka offline.
4. Meta tag mobile: viewport-fit=cover, theme-color, apple-touch-icon, safe-area insets dipakai di CSS.

### Mobile-first
5. Semua layout didesain dari breakpoint kecil dulu (grid 1 kolom, thumb zone: tombol aksi utama di bawah). Desktop = enhancement.
6. Target sentuh ≥ 44px, tanpa hover-dependent affordance.

### Redesign Light Playful — palet
7. Basis terang hangat, chunky rounded, warna ceria. Token baru (menggantikan orange Ecosystem dan TIDAK memakai dark+lime DESIGN.md lama):
   - `bg` krem hangat `#FDF6EC`
   - `surface` putih `#FFFFFF`, border lembut `#EADFD0`
   - primary cerah `#FF8A3D` (oranye matahari — aksi utama)
   - secondary hijau daun `#3FA34D` (progress, sukses)
   - accent biru langit `#2F80ED`, kuning koin `#F7C948`, merah bata `#E4572E` (Again/danger)
   - teks utama `#2D2A26`, teks sekunder `#8A8177`
   - Radius besar (16–24px), shadow lembut warna-warm, font tetap Inter; label mono JetBrains Mono boleh tinggal untuk angka kecil.
8. Palet ini ditulis ulang ke DESIGN.md sebagai design system baru (menggantikan section lama).

### Pemetaan halaman
9. **Home** = "Peta Petualangan": header sapaan + rank penjelajah + Jejak Harian 🐾; tiap habitat = kartu besar tap-able berisi nama, jumlah Kartu Siap hari itu, ring kuota harian, bar Kekuatan Habitat. Tap → mulai ekspedisi habitat itu. Kartu "Semua Habitat" paling atas.
10. **Ekspedisi** (pengganti /review): satu kartu fokus tengah, flip depan→belakang, tombol speaker, lalu 4 tombol rating berlabel playful tanpa istilah teknis: "Ulang" (Again), "Susah", "Oke" (Good), "Gampang" (Easy) — interval waktu dinamis FSRS tetap ditampilkan sebagai hint kecil ("· 4 hari") tapi FSRS/istilah teknis tidak pernah tampil.
11. **Layar pengaturan ringkas**: toggle suara, edit kuota harian global, info versi deck + tombol "Unduh ulang deck" (satu-satunya UI sync yang tersisa, eksplisit).
12. **Hapus dari web**: `CreateCardForm`, semua UI create, sync queue indicator, copy soal cloud/server. Rute `/review` diganti rute ekspedisi.
13. Layar gate sync pertama kali = layar onboarding bertema (kompas berputar + progress "523/2140 kata"), selesai → konfeti kecil masuk peta.

## Definisi selesai
- Bisa "Add to Home Screen" di Android/iOS, buka standalone fullscreen portrait, jalan offline penuh untuk review.
- Semua layar mobile-first, tak ada istilah teknis tersisa di UI.
- Home menampilkan peta habitat sesuai spec, ekspedisi mengikuti workflow ekspedisi-harian.md.
