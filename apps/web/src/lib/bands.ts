/*
 * Band gating — rantai progresi inggris-easy → medium → advance → native.
 * Band pertama selalu terbuka; band berikutnya terkunci sampai mastery band
 * sebelumnya ≥ 70% (auto-unlock) atau lulus Uji Khatam (≥ 8/10 benar).
 * Kategori non-band (general, custom) tidak pernah digate.
 */

import { db, type LocalCard } from "./db";
import { dayKey } from "./game";
import { makeRng, seededShuffle } from "./session";

export const BAND_ORDER = [
	"inggris-easy",
	"inggris-medium",
	"inggris-advance",
	"inggris-native",
] as const;

export function bandIndex(category: string): number {
	// indexOf butuh array string umum — tuple literal readonly tidak menerima string bebas.
	return (BAND_ORDER as readonly string[]).indexOf(category);
}

export function previousBand(category: string): string | null {
	const idx = bandIndex(category);
	if (idx <= 0) return null;
	return BAND_ORDER[idx - 1] ?? null;
}

export const KHATAM_PASS_SCORE = 8;
export const KHATAM_QUESTION_COUNT = 10;
export const AUTO_UNLOCK_MASTERY = 70;

export async function getUnlockedBands(): Promise<Set<string>> {
	const row = await db.meta.get("unlockedBands");
	const value = row?.value;
	const stored = Array.isArray(value)
		? value.filter((x): x is string => typeof x === "string")
		: [];
	return new Set(["inggris-easy", ...stored]);
}

export async function unlockBand(category: string): Promise<void> {
	const row = await db.meta.get("unlockedBands");
	const value = row?.value;
	const arr = Array.isArray(value)
		? value.filter((x): x is string => typeof x === "string")
		: [];
	if (!arr.includes(category)) {
		arr.push(category);
		await db.meta.put({ key: "unlockedBands", value: arr });
	}
}

export const BAND_METAS: Record<
	string,
	{
		id: string;
		title: string;
		subtitle: string;
		colorClass: string;
		accentColor: string;
		levelReq: string;
	}
> = {
	"inggris-easy": {
		id: "inggris-easy",
		title: "Easy",
		subtitle: "Fondasi kosakata esensial & harian",
		colorClass: "stage-easy",
		accentColor: "var(--success)",
		levelReq: "Tahap 1",
	},
	"inggris-medium": {
		id: "inggris-medium",
		title: "Medium",
		subtitle: "Percakapan umum, kerja & studi",
		colorClass: "stage-medium",
		accentColor: "var(--primary)",
		levelReq: "Tahap 2",
	},
	"inggris-advance": {
		id: "inggris-advance",
		title: "Advance",
		subtitle: "Kosakata profesional, artikel & akademik",
		colorClass: "stage-advance",
		accentColor: "#9065f0",
		levelReq: "Tahap 3",
	},
	"inggris-native": {
		id: "inggris-native",
		title: "Native",
		subtitle: "Idiom, nuansa sastra & ekspresi lisan",
		colorClass: "stage-native",
		accentColor: "var(--accent)",
		levelReq: "Tahap 4",
	},
};

export function getBandMeta(category: string) {
	return (
		BAND_METAS[category] ?? {
			id: category,
			title: category,
			subtitle: "Koleksi kosakata khusus",
			colorClass: "stage-general",
			accentColor: "var(--muted)",
			levelReq: "Khusus",
		}
	);
}

export interface ParsedBack {
	pos?: string;
	gloss: string;
	exampleEn?: string;
	exampleId?: string;
}

export function parseBackContent(back: string): ParsedBack {
	let glossPart = back;
	let exampleEn: string | undefined;
	let exampleId: string | undefined;

	if (back.includes(" Ex:")) {
		const parts = back.split(" Ex:");
		glossPart = parts[0]?.trim() ?? "";
		const exPart = parts[1]?.trim();
		if (exPart) {
			if (exPart.includes(" — ")) {
				const exParts = exPart.split(" — ");
				exampleEn = exParts[0]?.trim();
				exampleId = exParts[1]?.trim();
			} else {
				exampleEn = exPart;
			}
		}
	}

	let pos: string | undefined;
	const posMatch = glossPart.match(/^([a-zA-Z]{1,6}\.)\s*(.*)$/);
	if (posMatch) {
		pos = posMatch[1];
		glossPart = posMatch[2] ?? "";
	}

	return {
		pos,
		gloss: glossPart || back,
		exampleEn,
		exampleId,
	};
}

/** Buang contoh kalimat (" Ex: ...") — opsi kuis tetap ringkas. */
export function glossOnly(back: string): string {
	return parseBackContent(back).gloss;
}

function masteryPct(cards: LocalCard[], category: string): number {
	const bandCards = cards.filter((c) => c.category === category);
	const total = bandCards.length;
	const mature = bandCards.filter(
		(c) => c.state === 2 && c.stability >= 21,
	).length;
	return total > 0 ? Math.round((mature / total) * 100) : 0;
}

export async function autoUnlockEligible(
	category: string,
	now?: Date,
): Promise<boolean> {
	void now;
	const idx = bandIndex(category);
	if (idx <= 0) return false;
	const prev = previousBand(category);
	if (!prev) return false;
	const cards = await db.cards.toArray();
	return masteryPct(cards, prev) >= AUTO_UNLOCK_MASTERY;
}

export async function checkAutoUnlocks(unlocked?: Set<string>): Promise<void> {
	const current = unlocked ?? (await getUnlockedBands());
	for (const band of BAND_ORDER) {
		if (bandIndex(band) <= 0) continue;
		if (current.has(band)) continue;
		if (await autoUnlockEligible(band)) {
			await unlockBand(band);
		}
	}
}

export interface KhatamQuestion {
	front: string;
	correct: string;
	options: string[];
}

/**
 * Bangun kuis Uji Khatam: 10 kartu band diacak seeded harian (per device),
 * tiap soal = front + 4 opsi gloss (1 benar + 3 distractor, semua distinct).
 * Assessment only — tidak ada mutasi kartu.
 */
export async function buildKhatamQuiz(
	category: string,
	seedNonce?: number,
	now?: Date,
): Promise<KhatamQuestion[]> {
	const bandCards = await db.cards.where("category").equals(category).toArray();
	const deviceSeed = await getDeviceSeed();
	const seed = `${dayKey(now ?? new Date())}::${category}::khatam::${seedNonce ?? 0}::${deviceSeed}`;
	const rng = makeRng(seed);
	const shuffled = seededShuffle(bandCards, rng);
	const questions = shuffled.slice(0, KHATAM_QUESTION_COUNT);

	// Pool distractor: kartu band dulu; kalau band < 4 kartu, pakai semua kartu.
	let pool = bandCards;
	if (pool.length < 4) {
		pool = await db.cards.toArray();
	}

	return questions.map((card) => {
		const correct = glossOnly(card.back);
		const distinct = Array.from(
			new Set(
				pool
					.filter((c) => c.id !== card.id)
					.map((c) => glossOnly(c.back))
					.filter((g) => g !== correct),
			),
		);
		const distractors = seededShuffle(distinct, rng).slice(0, 3);
		const options = seededShuffle([correct, ...distractors], rng);
		return { front: card.front, correct, options };
	});
}

// Replika lokal getDeviceSeed (session.ts) — seed acak per device, persist Dexie.
async function getDeviceSeed(): Promise<string> {
	const row = await db.meta.get("deviceSeed");
	if (row && typeof row.value === "string") return row.value;
	const seed =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	await db.meta.put({ key: "deviceSeed", value: seed });
	return seed;
}
