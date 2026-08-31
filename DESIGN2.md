---
version: "light-playful-safari"
name: "Safari Kata — Light Playful"
description: "Tema gamifikasi petualangan yang hangat dan ramah: krem hangat, oranye matahari, hijau daun. Mobile-first untuk PWA flashcard offline-first."
colors:
  primary: "#FF8A3D"
  primary-hover: "#F0761F"
  secondary: "#3FA34D"
  accent: "#2F80ED"
  coin: "#F7C948"
  danger: "#E4572E"
  category-badge: "#4330C2"
  background: "#FDF6EC"
  surface: "#FFFFFF"
  border: "#EADFD0"
  text-primary: "#2D2A26"
  text-secondary: "#8A8177"
typography:
  display:
    fontFamily: "Inter"
    fontWeight: 800
    tracking: "tight"
  body:
    fontFamily: "Inter"
    fontSize: "16px"
    fontWeight: 400
  label:
    fontFamily: "JetBrains Mono"
    fontSize: "11-12px"
    fontWeight: 700
    transform: "uppercase"
spacing:
  base: "8px"
  card-padding: "20px"
  page-max: "28rem (mobile) / 48rem (md)"
rounded:
  card: "20px"
  control: "12px"
  pill: "9999px"
components:
  card: "Putih, border #EADFD0, shadow lembut warm, radius 20px"
  button-primary: "#FF8A3D, teks putih bold, radius 12px, active scale 0.98"
  toggle: "pill 56x32, ON hijau #3FA34D"
  ring-progress: "SVG stroke #3FA34D di track #EADFD0"
  habitat-badge: "mono uppercase, bg #4330C2 putih"
---
# Safari Kata — Light Playful
Design system untuk PWA flashcard gamifikasi offline-first. Menggantikan tema lama (Ecosystem orange & dark+lime).
## Kosakata gamifikasi (WAJIB di UI, dilarang istilah teknis)
- category → **Habitat**
- review session → **Ekspedisi**
- XP → **Koin** 🪙
- streak → **Jejak Harian** 🐾
- due cards → **Kata Siap**
- daily goal → **Target Harian**
- mastery % → **Kekuatan Habitat**
- FSRS/IndexedDB/sync/server → tidak pernah tampil
## Colors
Anchor: background krem `#FDF6EC`, surface putih, primary oranye `#FF8A3D` (aksi utama), hijau `#3FA34D` (progress/sukses), biru `#2F80ED` (aksen/unduh), kuning koin `#F7C948`, bata `#E4572E` (Again/danger), ungu `#4330C2` khusus badge kategori. Jangan swap peran warna.
## Typography
Inter untuk semua teks (800 untuk display/angka besar), JetBrains Mono 11-12px bold uppercase untuk label kecil dan angka progress.
## Layout
Mobile-first: max-width 28rem di mobile, 48rem di md+. Bottom tab bar (thumb zone) di mobile, header ramping 56px. Target sentuh ≥ 44px. Safe-area insets wajib (PWA standalone iOS).
## Motion
Fade-in-up staggered, flip kartu 0.4s spring-ish `cubic-bezier(0.16,1,0.3,1)`, koin pop dengan overshoot, kompas berputar pelan di layar sync. Semua dimatikan via `prefers-reduced-motion`.
## Guardrails
- Jangan pakai dark mode atau neon; tema ini light warm.
- Jangan tampilkan istilah teknis (FSRS, sync, cloud, IndexedDB) di UI mana pun.
- Palet primary/secondary lock; jangan ditukar.
