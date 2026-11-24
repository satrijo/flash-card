// packages/shared/index.test.ts
// Characterization test — seam: fungsi murni @flashcard/shared.
// Nilai ekspektasi dari sumber independen, bukan dari kode yang diuji:
// - normalizeCategory: spec R1 + AGENTS.md §6 (trim, lowercase, kosong -> "general").
// - buildFsrsUpdate: nilai golden FSRS dari probe ts-fsrs (25 Nov 2026,
//   deterministik antar proses) + properti algoritma.
// - createEmptyCard: perilaku createEmptyCard dari ts-fsrs (probe yang sama).

import { describe, expect, it } from "vitest";
import {
	FSRS_RATINGS,
	Rating,
	State,
	buildFsrsUpdate,
	createEmptyCard,
	isReservedHandle,
	normalizeCategory,
	normalizeUserHandle,
	type FSRSCard,
} from "./index.ts";

// Kartu baru, belum pernah direview — titik awal semua golden FSRS.
const NOW = new Date("2026-11-25T00:00:00.000Z");

function newCard(): FSRSCard {
	return createEmptyCard(NOW);
}

describe("normalizeCategory", () => {
	it("trim + lowercase", () => {
		expect(normalizeCategory("  Inggris ")).toBe("inggris");
		expect(normalizeCategory("KATA")).toBe("kata");
		expect(normalizeCategory("inggris-easy")).toBe("inggris-easy");
	});

	it("kosong atau hanya spasi jadi general", () => {
		expect(normalizeCategory("")).toBe("general");
		expect(normalizeCategory("   ")).toBe("general");
		expect(normalizeCategory(undefined)).toBe("general");
	});
});

describe("normalizeUserHandle", () => {
	it("lowercase + awalan kata-", () => {
		expect(normalizeUserHandle("Satriyo")).toBe("kata-satriyo");
		expect(normalizeUserHandle("kata-Admin")).toBe("kata-admin");
		expect(normalizeUserHandle("  Hero  ")).toBe("kata-hero");
	});

	it("karakter selain huruf/angka/_/- jadi -, beruntun digabung", () => {
		expect(normalizeUserHandle("Hello World!")).toBe("kata-hello-world-");
	});

	it("dipotong 30 karakter", () => {
		expect(normalizeUserHandle("a".repeat(40))).toBe(`kata-${"a".repeat(25)}`);
		expect(normalizeUserHandle("a".repeat(40)).length).toBe(30);
	});

	it("kosong jadi kata- (perilaku nyata, dikunci)", () => {
		expect(normalizeUserHandle("")).toBe("kata-");
	});
});

describe("isReservedHandle", () => {
	it("handle sistem persis -> reserved", () => {
		expect(isReservedHandle("kata-admin")).toBe(true);
		expect(isReservedHandle("kata-bot")).toBe(true);
	});

	it("kata reserved tanpa awalan kata- -> reserved", () => {
		expect(isReservedHandle("admin")).toBe(true);
		expect(isReservedHandle("kata-admin-x")).toBe(true);
		expect(isReservedHandle("kata-my-admin")).toBe(true);
	});

	it("handle biasa -> bukan reserved", () => {
		expect(isReservedHandle("kata-hero")).toBe(false);
		expect(isReservedHandle("kata-satriyo")).toBe(false);
		expect(isReservedHandle("kata-administrator2")).toBe(false);
	});
});

describe("FSRS_RATINGS", () => {
	it("nama rating memetakan ke enum Rating ts-fsrs", () => {
		expect(FSRS_RATINGS.again).toBe(Rating.Again);
		expect(FSRS_RATINGS.hard).toBe(Rating.Hard);
		expect(FSRS_RATINGS.good).toBe(Rating.Good);
		expect(FSRS_RATINGS.easy).toBe(Rating.Easy);
	});
});

describe("buildFsrsUpdate", () => {
	it("kartu baru + Good: due 10 menit, stability 2.3065, state Learning", () => {
		const next = buildFsrsUpdate(newCard(), Rating.Good, NOW);
		expect(next).toEqual({
			due: new Date("2026-11-25T00:10:00.000Z"),
			state: State.Learning,
			stability: 2.3065,
			difficulty: 2.11810397,
			elapsed_days: 0,
			scheduled_days: 0,
			learning_steps: 1,
			reps: 1,
			lapses: 0,
			last_review: NOW,
		});
	});

	it("kartu baru + Again: due 1 menit, difficulty naik, state Learning", () => {
		const next = buildFsrsUpdate(newCard(), Rating.Again, NOW);
		expect(next.due).toEqual(new Date("2026-11-25T00:01:00.000Z"));
		expect(next.stability).toBe(0.212);
		expect(next.difficulty).toBe(6.4133);
		expect(next.state).toBe(State.Learning);
		expect(next.reps).toBe(1);
		expect(next.lapses).toBe(0);
	});

	it("kartu baru + Hard: due 6 menit", () => {
		const next = buildFsrsUpdate(newCard(), Rating.Hard, NOW);
		expect(next.due).toEqual(new Date("2026-11-25T00:06:00.000Z"));
		expect(next.stability).toBe(1.2931);
		expect(next.difficulty).toBe(5.11217071);
		expect(next.state).toBe(State.Learning);
	});

	it("kartu baru + Easy: due 10 hari, state Review, scheduled 10 hari", () => {
		const next = buildFsrsUpdate(newCard(), Rating.Easy, NOW);
		expect(next.due).toEqual(new Date("2026-12-05T00:00:00.000Z"));
		expect(next.stability).toBe(8.2956);
		expect(next.difficulty).toBe(1);
		expect(next.scheduled_days).toBe(10);
		expect(next.state).toBe(State.Review);
	});

	it("review kedua (Good lalu Good besoknya): reps 2, elapsed 1 hari", () => {
		const once = buildFsrsUpdate(newCard(), Rating.Good, NOW);
		const card: FSRSCard = { ...newCard(), ...once };
		const twice = buildFsrsUpdate(
			card,
			Rating.Good,
			new Date("2026-11-26T00:00:00.000Z"),
		);
		expect(twice.due).toEqual(new Date("2026-12-03T00:00:00.000Z"));
		expect(twice.stability).toBe(7.31530068);
		expect(twice.elapsed_days).toBe(1);
		expect(twice.scheduled_days).toBe(7);
		expect(twice.reps).toBe(2);
		expect(twice.state).toBe(State.Review);
	});

	it("hasilnya tepat 10 field FSRS, tidak lebih", () => {
		const next = buildFsrsUpdate(newCard(), Rating.Good, NOW);
		expect(Object.keys(next).sort()).toEqual(
			[
				"difficulty",
				"due",
				"elapsed_days",
				"lapses",
				"last_review",
				"learning_steps",
				"reps",
				"scheduled_days",
				"stability",
				"state",
			].sort(),
		);
	});

	it("tidak mengubah kartu asal", () => {
		const card = newCard();
		buildFsrsUpdate(card, Rating.Good, NOW);
		expect(card.reps).toBe(0);
		expect(card.state).toBe(State.New);
	});
});

describe("createEmptyCard", () => {
	it("kartu baru: semua nol, due = waktu yang diberikan", () => {
		const card = createEmptyCard(NOW);
		expect(card.due).toEqual(NOW);
		expect(card.stability).toBe(0);
		expect(card.difficulty).toBe(0);
		expect(card.state).toBe(State.New);
		expect(card.elapsed_days).toBe(0);
		expect(card.scheduled_days).toBe(0);
		expect(card.learning_steps).toBe(0);
		expect(card.reps).toBe(0);
		expect(card.lapses).toBe(0);
		expect(card.last_review).toBeUndefined();
	});
});
