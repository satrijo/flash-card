// apps/api/src/deck-version.test.ts
// Characterization test — seam: deckVersionFromRows (FNV-1a atas isi deck).
// Nilai golden dari implementasi FNV-1a independen (Python, dari definisi
// algoritma: basis 0x811c9dc5, prima 0x01000193, xor lalu kalikan per char),
// bukan dari kode yang diuji. Properti (deterministik, sensitif, urutan)
// mengunci perilaku nyata: fungsi ini TIDAK mengurutkan baris — pemanggil
// yang mengurutkan via .orderBy(asc(cards.id)).

import { describe, expect, it } from "vitest";
import { deckVersionFromRows } from "./index";

type Row = { id: string; front: string; back: string; category: string };

const ONE: Row = { id: "1", front: "hello", back: "halo", category: "general" };
const TWO: Row = { id: "2", front: "world", back: "dunia", category: "general" };

describe("deckVersionFromRows", () => {
	it("deck kosong -> hash basis FNV-1a (tidak ada langkah sama sekali)", () => {
		expect(deckVersionFromRows([])).toBe("fnv1a-811c9dc5");
	});

	it("satu baris -> golden dari implementasi FNV-1a independen", () => {
		expect(deckVersionFromRows([ONE])).toBe("fnv1a-2f5f5895");
	});

	it("dua baris -> golden dari implementasi FNV-1a independen", () => {
		expect(deckVersionFromRows([ONE, TWO])).toBe("fnv1a-50973d47");
	});

	it("deterministik: input sama -> hash sama", () => {
		expect(deckVersionFromRows([ONE, TWO])).toBe(deckVersionFromRows([ONE, TWO]));
	});

	it("sensitif: satu karakter berubah -> hash berbeda", () => {
		const changed = { ...ONE, front: "hellp" };
		expect(deckVersionFromRows([changed])).not.toBe(deckVersionFromRows([ONE]));
		expect(deckVersionFromRows([changed])).toBe("fnv1a-98422140");
	});

	it("urutan baris berpengaruh (fungsi tidak mengurutkan sendiri)", () => {
		expect(deckVersionFromRows([TWO, ONE])).toBe("fnv1a-a6fd251f");
		expect(deckVersionFromRows([TWO, ONE])).not.toBe(deckVersionFromRows([ONE, TWO]));
	});

	it("format: fnv1a- + 8 hex", () => {
		expect(deckVersionFromRows([ONE])).toMatch(/^fnv1a-[0-9a-f]{8}$/);
	});
});
