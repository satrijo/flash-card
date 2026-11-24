import { db, type LocalCard } from "./db";
import { dayKey, levelFromXp } from "./game";
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

export interface StageRequirement {
	matureWords: number; // Jalur A: Target kata matang (FSRS stability >= 21)
	minLevel: number; // Jalur B: Target level gamifikasi pemain
	label: string;
}

// Syarat multi-jalur untuk membuka tahap berikutnya
export const STAGE_REQUIREMENTS: Record<string, StageRequirement> = {
	"inggris-medium": {
		matureWords: 500,
		minLevel: 15,
		label: "500 kata Easy (A1–A2) dikuasai atau Level 15",
	},
	"inggris-advance": {
		matureWords: 1000,
		minLevel: 30,
		label: "1000 kata Medium (B1–B2) dikuasai atau Level 30",
	},
	"inggris-native": {
		matureWords: 1500,
		minLevel: 45,
		label: "1500 kata Advance (C1) dikuasai atau Level 45",
	},
};

export function getStageRequirement(category: string): StageRequirement {
	return (
		STAGE_REQUIREMENTS[category] ?? {
			matureWords: 500,
			minLevel: 15,
			label: "500 kata dikuasai atau Level 15",
		}
	);
}

export async function getUnlockedBands(): Promise<Set<string>> {
	const row = await db.meta.get("quizUnlockedBands");
	const value = row?.value;
	const quizPassed = Array.isArray(value)
		? value.filter((x): x is string => typeof x === "string")
		: [];
	const unlocked = new Set<string>(["inggris-easy", ...quizPassed]);

	const cards = await db.cards.toArray();
	const stats = await db.gameStats.get("user");
	const level = stats ? levelFromXp(stats.xp).level : 1;

	for (const band of BAND_ORDER) {
		if (bandIndex(band) <= 0) continue;
		if (unlocked.has(band)) continue;
		const { eligible } = getUnlockProgress(cards, band, level);
		if (eligible) {
			unlocked.add(band);
		}
	}

	return unlocked;
}

export async function unlockBand(category: string): Promise<void> {
	const row = await db.meta.get("quizUnlockedBands");
	const value = row?.value;
	const arr = Array.isArray(value)
		? value.filter((x): x is string => typeof x === "string")
		: [];
	if (!arr.includes(category)) {
		arr.push(category);
		await db.meta.put({ key: "quizUnlockedBands", value: arr });
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
		badge: string;
	}
> = {
	"inggris-easy": {
		id: "inggris-easy",
		title: "Easy (A1–A2)",
		subtitle: "Fondasi kosakata esensial & harian (~1.000 kata)",
		colorClass: "stage-easy",
		accentColor: "var(--success)",
		levelReq: "Tahap 1",
		badge: "A1–A2",
	},
	"inggris-medium": {
		id: "inggris-medium",
		title: "Medium (B1–B2)",
		subtitle: "Percakapan umum, kerja & studi (~2.000 kata)",
		colorClass: "stage-medium",
		accentColor: "var(--primary)",
		levelReq: "Tahap 2",
		badge: "B1–B2",
	},
	"inggris-advance": {
		id: "inggris-advance",
		title: "Advance (C1)",
		subtitle: "Kosakata akademis & profesional (~2.000 kata)",
		colorClass: "stage-advance",
		accentColor: "#9065f0",
		levelReq: "Tahap 3",
		badge: "C1",
	},
	"inggris-native": {
		id: "inggris-native",
		title: "Native (C2)",
		subtitle: "Ekspresi tingkat mahir & idiom (~3.000+ kata)",
		colorClass: "stage-native",
		accentColor: "var(--accent)",
		levelReq: "Tahap 4",
		badge: "C2",
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

export interface GlossItem {
	pos?: string;
	posLabel?: string;
	posFull?: string;
	tone?: string;
	text: string;
}

export interface ParsedBack {
	pos?: string;
	gloss: string;
	items: GlossItem[];
	exampleEn?: string;
	exampleId?: string;
}

export const POS_MAP: Record<
	string,
	{ label: string; full: string; tone: string }
> = {
	n: {
		label: "n",
		full: "nomina (kata benda)",
		tone: "bg-blue-500/15 text-blue-400 border-blue-500/30",
	},
	v: {
		label: "v",
		full: "verba (kata kerja)",
		tone: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
	},
	a: {
		label: "adj",
		full: "adjektiva (kata sifat)",
		tone: "bg-amber-500/15 text-amber-400 border-amber-500/30",
	},
	adj: {
		label: "adj",
		full: "adjektiva (kata sifat)",
		tone: "bg-amber-500/15 text-amber-400 border-amber-500/30",
	},
	adv: {
		label: "adv",
		full: "adverbia (kata keterangan)",
		tone: "bg-purple-500/15 text-purple-400 border-purple-500/30",
	},
	konj: {
		label: "konj",
		full: "konjungsi (kata hubung)",
		tone: "bg-pink-500/15 text-pink-400 border-pink-500/30",
	},
	conj: {
		label: "konj",
		full: "konjungsi (kata hubung)",
		tone: "bg-pink-500/15 text-pink-400 border-pink-500/30",
	},
	prep: {
		label: "prep",
		full: "preposisi (kata depan)",
		tone: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
	},
	pron: {
		label: "pron",
		full: "pronomina (kata ganti)",
		tone: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
	},
	num: {
		label: "num",
		full: "numeralia (kata bilangan)",
		tone: "bg-orange-500/15 text-orange-400 border-orange-500/30",
	},
	part: {
		label: "part",
		full: "partikel",
		tone: "bg-teal-500/15 text-teal-400 border-teal-500/30",
	},
	interj: {
		label: "interj",
		full: "interjeksi (kata seru)",
		tone: "bg-rose-500/15 text-rose-400 border-rose-500/30",
	},
};

export function parseBackContent(back: string): ParsedBack {
	let glossPart = back.trim();
	let exampleEn: string | undefined;
	let exampleId: string | undefined;

	if (glossPart.includes(" Ex:")) {
		const parts = glossPart.split(" Ex:");
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

	const items: GlossItem[] = [];
	// Regex penanda kelas kata di awal string atau setelah tanda titik koma
	const posRegex =
		/(?:^|;\s*)\b(konj|conj|prep|pron|interj|part|num|adj|adv|n|v|a)\b\.?\s+/gi;
	const matches: Array<{
		pos: string;
		startIndex: number;
		matchEndIndex: number;
	}> = [];

	let m = posRegex.exec(glossPart);
	while (m !== null) {
		const posStr = m[1]?.toLowerCase() ?? "";
		const startIndex = m.index;
		const matchEndIndex = posRegex.lastIndex;
		matches.push({ pos: posStr, startIndex, matchEndIndex });
		m = posRegex.exec(glossPart);
	}

	if (matches.length > 0) {
		for (let i = 0; i < matches.length; i++) {
			const current = matches[i];
			if (!current) continue;
			const next = matches[i + 1];
			const nextStart = next ? next.startIndex : glossPart.length;
			let text = glossPart.slice(current.matchEndIndex, nextStart).trim();
			text = text.replace(/^[;\s]+|[.;\s]+$/g, "").trim();

			const posMeta = POS_MAP[current.pos];
			items.push({
				pos: current.pos,
				posLabel: posMeta?.label ?? current.pos,
				posFull: posMeta?.full,
				tone: posMeta?.tone ?? "bg-surface-2 text-muted border-edge/60",
				text,
			});
		}
	} else {
		items.push({
			text: glossPart.replace(/[.;\s]+$/g, "").trim() || back,
		});
	}

	const cleanGloss =
		items
			.map((i) => i.text)
			.filter(Boolean)
			.join("; ") || glossPart;
	const firstPos = items[0]?.pos;

	return {
		pos: firstPos,
		gloss: cleanGloss,
		items,
		exampleEn,
		exampleId,
	};
}

/** Buang contoh kalimat (" Ex: ...") — opsi kuis tetap ringkas. */
export function glossOnly(back: string): string {
	return parseBackContent(back).gloss;
}

export function getBandMatureCount(
	cards: LocalCard[],
	category: string,
): number {
	return cards.filter(
		(c) => c.category === category && c.state === 2 && c.stability >= 21,
	).length;
}

export function getUnlockProgress(
	cards: LocalCard[],
	targetCategory: string,
	currentLevel = 1,
): {
	mature: number;
	targetWords: number;
	currentLevel: number;
	targetLevel: number;
	wordsPct: number;
	levelPct: number;
	pct: number;
	eligible: boolean;
	hint: string;
} {
	const prev = previousBand(targetCategory);
	const req = getStageRequirement(targetCategory);

	if (!prev) {
		return {
			mature: 0,
			targetWords: 0,
			currentLevel,
			targetLevel: 1,
			wordsPct: 100,
			levelPct: 100,
			pct: 100,
			eligible: true,
			hint: "",
		};
	}

	const mature = getBandMatureCount(cards, prev);
	const wordsPct = Math.min(100, Math.round((mature / req.matureWords) * 100));
	const levelPct =
		req.minLevel > 1
			? Math.max(
					0,
					Math.min(
						100,
						Math.round(((currentLevel - 1) / (req.minLevel - 1)) * 100),
					),
				)
			: 100;
	// Progres multi-path: ambil persentase tertinggi antara pencapaian kata atau level
	const pct = Math.max(wordsPct, levelPct);
	const eligible = mature >= req.matureWords || currentLevel >= req.minLevel;
	const prevMeta = getBandMeta(prev);

	const hint = `Kuasai ${req.matureWords} kata ${prevMeta.title} (${mature}/${req.matureWords}), capai Level ${req.minLevel} (saat ini Lvl ${currentLevel}), atau Uji Naik Tahap`;

	return {
		mature,
		targetWords: req.matureWords,
		currentLevel,
		targetLevel: req.minLevel,
		wordsPct,
		levelPct,
		pct,
		eligible,
		hint,
	};
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
	const stats = await db.gameStats.get("user");
	const level = stats ? levelFromXp(stats.xp).level : 1;
	const { eligible } = getUnlockProgress(cards, category, level);
	return eligible;
}

export async function checkAutoUnlocks(unlocked?: Set<string>): Promise<void> {
	// Evaluasi auto-unlock dijalankan secara dinamis saat getUnlockedBands() dipanggil.
	void unlocked;
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
