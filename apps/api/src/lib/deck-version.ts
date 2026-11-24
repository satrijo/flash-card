// apps/api/src/lib/deck-version.ts
// FNV-1a 32-bit atas seluruh isi tabel cards (di-sort by id supaya stabil).
// Dipakai client sebagai version-check: sama = skip download.
// Catatan: fungsi ini TIDAK mengurutkan baris — pemanggil mengurutkan
// via .orderBy(asc(cards.id)) sebelum memanggil (urutan berpengaruh
// pada hash; dikunci oleh deck-version.test.ts).

export function deckVersionFromRows(
	rows: { id: string; front: string; back: string; category: string }[],
): string {
	let hash = 0x811c9dc5;
	const step = (s: string) => {
		for (let i = 0; i < s.length; i++) {
			hash ^= s.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
	};
	for (const r of rows) {
		step(`${r.id}\u0000${r.front}\u0000${r.back}\u0000${r.category}`);
		step("\u0001"); // pemisah antar kartu
	}
	return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

// Cache versi deck di memori Worker (5 menit) — supaya cek versi tidak
// membaca ±2.500 baris di setiap sync check. State tinggal di modul ini;
// routes/deck.ts hanya membaca/menulis lewat dua fungsi di bawah.
let cached: { version: string; count: number; expiresAt: number } | null =
  null;

export function getCachedDeckVersion() {
  return cached;
}

export function setCachedDeckVersion(value: {
  version: string;
  count: number;
  expiresAt: number;
}) {
  cached = value;
}

