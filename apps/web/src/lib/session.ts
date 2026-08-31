/*
 * Sesi ekspedisi — urutan kartu diacak seeded harian (bukan urutan due),
 * tidak pernah lompat habitat (filter kategori dulu, baru shuffle),
 * dan kartu Again masuk lagi ke belakang antrian sesi.
 */

import { bandIndex, getUnlockedBands } from "./bands";
import { db, type LocalCard } from "./db";
import {
	countTodayReviewsByCategory,
	DEFAULT_DAILY_GOAL,
	DEFAULT_HABITAT_QUOTA,
	dayKey,
	ensureGameStats,
	getHabitatQuota,
} from "./game";

// PRNG mulberry32 — deterministik dari seed string.
function hashSeed(str: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}

export function makeRng(seedStr: string): () => number {
	let a = hashSeed(seedStr);
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher-Yates shuffle deterministik terhadap rng. */
export function seededShuffle<T>(items: T[], rng: () => number): T[] {
	const arr = [...items];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = arr[i] as T;
		arr[i] = arr[j] as T;
		arr[j] = tmp as T;
	}
	return arr;
}

/**
 * Seed acak khusus device — dibuat sekali dan persist di Dexie.
 * Device/incognito berbeda → antrean acak berbeda meski hari sama.
 */
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

/**
 * Bangun antrean ekspedisi hari ini dengan standar prioritas SRS Anki:
 * 1. Learning & Relearning (State 1 & 3) yang jatuh tempo -> PRIORITAS TERTINGGI
 * 2. Review Overdue (State 2) -> Diurutkan berdasarkan overdue tertua / stability terendah
 * 3. Kartu Baru (State 0) -> Diacak deterministik harian dan mengisi sisa kuota harian
 */
export async function buildEkspedisiQueue(
	category: string | undefined,
	now: Date = new Date(),
): Promise<LocalCard[]> {
	const nowMs = now.getTime();
	const allDue = await db.cards
		.where("due")
		.belowOrEqual(new Date(nowMs))
		.toArray();
	const unlocked = await getUnlockedBands();

	const filtered = allDue.filter((c) => {
		const cat = c.category || "general";
		if (category) return cat === category;
		if (bandIndex(cat) <= 0) return true;
		return unlocked.has(cat);
	});

	// Kelompokkan kartu sesuai model memori Anki
	const learningDue: LocalCard[] = [];
	const reviewDue: LocalCard[] = [];
	const newCardsDue: LocalCard[] = [];

	for (const card of filtered) {
		if (card.state === 1 || card.state === 3) {
			// Sedang dalam siklus belajar / relearning
			learningDue.push(card);
		} else if (card.state === 2) {
			// Review berkala (kartu yang sudah pernah dihafal)
			reviewDue.push(card);
		} else {
			// Kartu baru (belum pernah diulas)
			newCardsDue.push(card);
		}
	}

	// 1. Learning cards diurutkan berdasarkan due time (yang paling dulu jatuh tempo)
	learningDue.sort(
		(a, b) => new Date(a.due).getTime() - new Date(b.due).getTime(),
	);

	// 2. Review cards diurutkan berdasarkan overdue tertua & stability terendah
	reviewDue.sort((a, b) => {
		const diffDue = new Date(a.due).getTime() - new Date(b.due).getTime();
		if (diffDue !== 0) return diffDue;
		return a.stability - b.stability;
	});

	// 3. New cards diacak secara deterministik harian
	const deviceSeed = await getDeviceSeed();
	const seed = `${dayKey(now)}::${category ?? "semua"}::${deviceSeed}`;
	const shuffledNew = seededShuffle(newCardsDue, makeRng(seed));

	// Gabungkan review cards terlebih dahulu (Reviews First, New Later)
	const mustReview = [...learningDue, ...reviewDue];

	// Batasi ke target harian / ukuran batch sesi yang terukur
	const { quota, remaining } = await sessionCap(category, now);
	const sessionSize =
		quota > 0 ? (remaining > 0 ? remaining : quota) : DEFAULT_HABITAT_QUOTA;

	if (mustReview.length >= sessionSize) {
		// Batasi antrean sesi agar tidak membebani pengguna dengan ratusan kartu sekaligus
		return mustReview.slice(0, sessionSize);
	}

	// Jika masih ada slot tersisa dalam sesi, isi dengan kartu baru
	const neededNew = Math.max(0, sessionSize - mustReview.length);
	return [...mustReview, ...shuffledNew.slice(0, neededNew)];
}

/**
 * Batas sesi ekspedisi: kuota harian (global atau per habitat) dan sisa
 * yang belum direview hari ini. Kuota 0 = free-play (tanpa batas).
 */
export async function sessionCap(
	category: string | undefined,
	now: Date = new Date(),
): Promise<{ quota: number; remaining: number }> {
	await ensureGameStats();
	const quota = category
		? await getHabitatQuota(category)
		: ((await db.gameStats.get("user"))?.dailyGoal ?? DEFAULT_DAILY_GOAL);
	if (quota <= 0) return { quota: 0, remaining: 0 };
	const today = await countTodayReviewsByCategory(now);
	const reviewedToday = category
		? (today[category] ?? 0)
		: Object.values(today).reduce((sum, n) => sum + n, 0);
	return { quota, remaining: Math.max(0, quota - reviewedToday) };
}

/**
 * Re-queue untuk jawaban Again: kartu dimasukkan ulang di belakang antrian
 * dengan jeda minimal 2 posisi agar tidak muncul langsung berikutnya.
 */
export function requeueAgain(
	queue: LocalCard[],
	cursor: number,
	card: LocalCard,
): void {
	const insertAt = Math.min(queue.length, cursor + 3);
	queue.splice(insertAt, 0, card);
}
