# Workflow: Ekspedisi Harian (Review Loop)

Loop inti user: buka app → masuk Habitat → ekspedisi kartu → dapat koin → target harian terpenuhi. Semua komputasi lokal, tanpa server.

## Keputusan terkunci

### Urutan kartu — shuffle + anti-repeat
1. Kartu due di-query seperti sekarang (`where("due").below(now)`), lalu **di-shuffle seeded per hari** (seed = `dayKey` + category; Fisher-Yates deterministik). Hari beda → urutan beda. Kategori beda → seed beda.
2. Filter kategori TETAP dulu, baru shuffle — tidak pernah lompat habitat kecuali mode "Semua Habitat" yang memang campuran.
3. **Anti-repeat:** kartu dijawab `Again` → dimasukkan ulang di belakang antrian sesi (dengan jeda ≥ 2 kartu agar tidak muncul langsung). Kartu `Good/Hard/Easy` keluar dari sesi.
4. Progress bar sesi menghitung kartu unik, bukan total antrean termasuk re-queue.

### Target per habitat
5. Tiap habitat punya **kuota harian** (default 10/hari) yang bisa diedit user: stepper − / + di tiap kartu habitat di Home, persist di Dexie `habitats` (per category name).
6. Ring/bar progress kuota per habitat terisi oleh review hari itu pada habitat tersebut.
7. **Kekuatan Habitat (mastery %)** = persentase kartu habitat dengan `state === ReviewState.Review && stability >= 21` (kartu mature ala FSRS) terhadap seluruh kartu habitat. Ditampilkan sebagai bar jangka panjang + badge saat 100%.
8. Target harian global (dailyGoal) tetap ada sebagai total lintas habitat.

### TTS (pengucapan)
9. Web Speech API `speechSynthesis`, bahasa `en-US`.
10. **Autoplay sisi depan** saat kartu muncul (kata Inggris), jika toggle suara aktif.
11. **Tombol speaker**: sisi depan (ulangi kata EN) dan sisi belakang (ucapkan terjemahan ID, voice `id-ID`).
12. Toggle on/off di layar pengaturan ringkas; default ON; persist di Dexie `meta`.

### Gamifikasi flavor — Safari (Light Playful)
13. Kosakata UI mengikuti NOTES.md: Habitat, Ekspedisi, Koin, Jejak Harian 🐾, Kartu Siap, Target Harian, Kekuatan Habitat.
14. Rank penjelajah per level: Pemula → Penjelajah → Pemandu → Penakluk → Legenda.
15. Koin per jawaban tetap: again 5 / hard 8 / good 10 / easy 15. Level-up → animasi rayakan ("Naik pangkat!").
16. Streak = Jejak Harian dengan ikon jejak kaki, logika day-roll existing dipertahankan.

## Definisi selesai
- Masuk `/ekspedisi?habitat=X` (atau padanan rute): urutan acak, beda tiap hari, tak pernah lompat habitat.
- Jawab Again → kartu itu muncul lagi di ekspedisi yang sama.
- Suara keluar otomatis saat kartu depan tampil; bisa dimatikan.
- Tiap kartu habitat menunjukkan ring kuota harian + bar kekuatan habitat yang bergerak setelah review.
