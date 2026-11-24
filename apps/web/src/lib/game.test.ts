// apps/web/src/lib/game.test.ts
// Characterization test — seam: fungsi murni game.ts (XP/level/rank/hari).
// Nilai ekspektasi dihitung tangan dari rumus di game.ts:
// xpForLevelStart(L) = 50*L*(L-1) -> L1 0, L2 100, L3 300, L4 600, L5 1000.
// Komponen React TIDAK diuji di change ini (keputusan T2, design §4).

import { Rating } from "@flashcard/shared";
import { describe, expect, it } from "vitest";
import { dayKey, levelFromXp, rankForLevel, xpForRating } from "./game";

describe("xpForRating", () => {
	it("XP per rating: Again 5, Hard 8, Good 10, Easy 15", () => {
		expect(xpForRating(Rating.Again)).toBe(5);
		expect(xpForRating(Rating.Hard)).toBe(8);
		expect(xpForRating(Rating.Good)).toBe(10);
		expect(xpForRating(Rating.Easy)).toBe(15);
	});

	it("Manual bukan rating review -> throw", () => {
		expect(() => xpForRating(Rating.Manual)).toThrow();
	});
});

describe("levelFromXp", () => {
	it("0 XP -> level 1, Pemula, mulai 0, berikutnya 100", () => {
		expect(levelFromXp(0)).toEqual({
			level: 1,
			levelStartXp: 0,
			nextLevelXp: 100,
			progressPct: 0,
			rankName: "Pemula",
		});
	});

	it("100 XP -> level 2 (rank masih Pemula — lihat catatan off-by-one)", () => {
		expect(levelFromXp(100)).toEqual({
			level: 2,
			levelStartXp: 100,
			nextLevelXp: 300,
			progressPct: 0,
			rankName: "Pemula",
		});
	});

	it("150 XP -> level 2, progres 25%", () => {
		expect(levelFromXp(150).progressPct).toBe(25);
	});

	it("250 XP -> level 2, progres 75%", () => {
		expect(levelFromXp(250).progressPct).toBe(75);
	});

	it("300 XP -> level 3, Terampil; 1000 XP -> level 5, Pakar", () => {
		expect(levelFromXp(300).level).toBe(3);
		expect(levelFromXp(300).rankName).toBe("Terampil");
		expect(levelFromXp(1000).level).toBe(5);
		expect(levelFromXp(1000).rankName).toBe("Pakar");
	});
});

describe("rankForLevel", () => {
	// CATATAN (temuan out-of-scope, dicatat di RUN-REPORT, TIDAK diperbaiki
	// di change ini — refactor-only): mapping ini off-by-one. Level 2 masih
	// "Pemula" (idx = level-2), "Legenda" baru muncul di level 6 — dan itu
	// pun langsung berbintang ("Legenda ⭐"). Test ini mengunci perilaku
	// nyata, bukan perilaku yang seharusnya.
	it("1 dan 2 Pemula, 3 Terampil, 4 Mahir, 5 Pakar", () => {
		expect(rankForLevel(1)).toBe("Pemula");
		expect(rankForLevel(2)).toBe("Pemula");
		expect(rankForLevel(3)).toBe("Terampil");
		expect(rankForLevel(4)).toBe("Mahir");
		expect(rankForLevel(5)).toBe("Pakar");
	});

	it("level 6 ke atas: Legenda + satu bintang per level", () => {
		expect(rankForLevel(6)).toBe("Legenda ⭐");
		expect(rankForLevel(7)).toBe("Legenda ⭐⭐");
	});
});

describe("dayKey", () => {
	it("format lokal YYYY-MM-DD", () => {
		expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
		expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
	});
});
